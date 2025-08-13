import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

// Get palette from environment variables
const getPalette = (): string[] => {
  const paletteEnv = process.env.PALETTE;
  if (!paletteEnv) {
    throw new Error("PALETTE environment variable not set");
  }
  try {
    return JSON.parse(paletteEnv);
  } catch (error) {
    throw new Error("Invalid PALETTE environment variable format");
  }
};

// Get size from environment variables
const getSize = (): { width: number; height: number } => {
  const sizeEnv = process.env.SIZE;
  if (!sizeEnv) {
    throw new Error("SIZE environment variable not set");
  }
  try {
    const [width, height] = sizeEnv.split(',').map(s => parseInt(s.trim(), 10));
    if (isNaN(width) || isNaN(height) || width <= 0 || height <= 0) {
      throw new Error("Invalid SIZE format. Expected 'width,height' with positive numbers");
    }
    return { width, height };
  } catch (error) {
    throw new Error("Invalid SIZE environment variable format. Expected 'width,height'");
  }
};

// Helper function to validate color is in palette
const isValidColor = (color: string): boolean => {
  const palette = getPalette();
  return palette.includes(color);
};

// Get the palette
export const getPaletteColors = query({
  args: {},
  handler: async () => {
    return getPalette();
  },
});

// Get the canvas data - returns canvas info and pixel map (not full array)
export const getCanvas = query({
  args: {},
  handler: async (ctx) => {
    const { width, height } = getSize();
    
    // Check if canvas is initialized
    const config = await ctx.db
      .query("canvas_config")
      .first();
    
    if (!config) {
      return null; // Canvas not initialized
    }
    
    // Check if resize is needed
    const needsResize = config.width !== width || config.height !== height;
    
    // Get all pixels and return as a map instead of array
    const pixelDocs = await ctx.db
      .query("pixels")
      .collect();
    
    // Create a pixel map (coordinate string -> color)
    const pixelMap: Record<string, string> = {};
    
    for (const pixel of pixelDocs) {
      // Only include pixels that are within the current canvas bounds
      if (pixel.x >= 0 && pixel.x < width && pixel.y >= 0 && pixel.y < height) {
        pixelMap[`${pixel.x},${pixel.y}`] = pixel.color;
      }
    }
    
    return {
      width,
      height,
      pixelMap, // Instead of pixels array
      palette: getPalette(),
      needsResize,
    };
  },
});

// Handle canvas resizing - removes pixels outside new bounds
export const resizeCanvas = mutation({
  args: {},
  handler: async (ctx) => {
    const { width, height } = getSize();
    
    let config = await ctx.db
      .query("canvas_config")
      .first();
    
    if (!config) {
      // Create config if it doesn't exist
      await ctx.db.insert("canvas_config", {
        width,
        height,
        initialized: true,
      });
      return { success: true, resized: true };
    }
    
    // Only resize if needed
    if (config.width !== width || config.height !== height) {
      // Update config
      await ctx.db.patch(config._id, {
        width,
        height,
      });
      
      // Remove pixels that are now outside the canvas bounds
      const pixelsToRemove = await ctx.db
        .query("pixels")
        .filter((q) => 
          q.or(
            q.gte(q.field("x"), width),
            q.gte(q.field("y"), height),
            q.lt(q.field("x"), 0),
            q.lt(q.field("y"), 0)
          )
        )
        .collect();
      
      // Delete out-of-bounds pixels
      for (const pixel of pixelsToRemove) {
        await ctx.db.delete(pixel._id);
      }
      
      return { success: true, resized: true };
    }
    
    return { success: true, resized: false };
  },
});

// Initialize canvas if it doesn't exist
export const initializeCanvas = mutation({
  args: {},
  handler: async (ctx) => {
    const { width, height } = getSize();
    
    const existingConfig = await ctx.db
      .query("canvas_config")
      .first();

    if (existingConfig) {
      return existingConfig._id;
    }

    // Create canvas config
    const configId = await ctx.db.insert("canvas_config", {
      width,
      height,
      initialized: true,
    });

    return configId;
  },
});

// Update a single pixel - much simpler now!
export const updatePixel = mutation({
  args: {
    x: v.number(),
    y: v.number(),
    color: v.string(),
  },
  handler: async (ctx, args) => {
    // Validate that the color is in the current palette
    if (!isValidColor(args.color)) {
      throw new Error(`Invalid color: ${args.color}. Color must be one of the palette colors.`);
    }

    const { width, height } = getSize();
    
    // Check bounds
    if (args.x < 0 || args.x >= width || args.y < 0 || args.y >= height) {
      throw new Error(`Coordinates (${args.x}, ${args.y}) are out of bounds`);
    }

    // Check if pixel already exists at this coordinate
    const existingPixel = await ctx.db
      .query("pixels")
      .withIndex("by_coordinates", (q) => 
        q.eq("x", args.x).eq("y", args.y)
      )
      .first();

    if (existingPixel) {
      // Update existing pixel
      await ctx.db.patch(existingPixel._id, {
        color: args.color,
      });
    } else {
      // Create new pixel
      await ctx.db.insert("pixels", {
        x: args.x,
        y: args.y,
        color: args.color,
      });
    }

    return { success: true };
  },
});

// Get a specific pixel (useful for real-time updates)
export const getPixel = query({
  args: {
    x: v.number(),
    y: v.number(),
  },
  handler: async (ctx, args) => {
    const pixel = await ctx.db
      .query("pixels")
      .withIndex("by_coordinates", (q) => 
        q.eq("x", args.x).eq("y", args.y)
      )
      .first();

    return pixel ? pixel.color : '#FFFFFF'; // Default to white if no pixel exists
  },
});

// Get pixels in a specific region (useful for loading visible area)
export const getPixelsInRegion = query({
  args: {
    startX: v.number(),
    startY: v.number(),
    endX: v.number(),
    endY: v.number(),
  },
  handler: async (ctx, args) => {
    const pixels = await ctx.db
      .query("pixels")
      .filter((q) =>
        q.and(
          q.gte(q.field("x"), args.startX),
          q.lte(q.field("x"), args.endX),
          q.gte(q.field("y"), args.startY),
          q.lte(q.field("y"), args.endY)
        )
      )
      .collect();

    return pixels;
  },
});

// Bulk update pixels (useful for importing or batch operations)
export const updatePixels = mutation({
  args: {
    pixels: v.array(v.object({
      x: v.number(),
      y: v.number(),
      color: v.string(),
    })),
  },
  handler: async (ctx, args) => {
    const { width, height } = getSize();
    
    for (const pixel of args.pixels) {
      // Validate color
      if (!isValidColor(pixel.color)) {
        throw new Error(`Invalid color: ${pixel.color}. Color must be one of the palette colors.`);
      }
      
      // Check bounds
      if (pixel.x < 0 || pixel.x >= width || pixel.y < 0 || pixel.y >= height) {
        continue; // Skip out-of-bounds pixels
      }
      
      // Check if pixel already exists
      const existingPixel = await ctx.db
        .query("pixels")
        .withIndex("by_coordinates", (q) => 
          q.eq("x", pixel.x).eq("y", pixel.y)
        )
        .first();

      if (existingPixel) {
        // Update existing pixel
        await ctx.db.patch(existingPixel._id, {
          color: pixel.color,
        });
      } else {
        // Create new pixel
        await ctx.db.insert("pixels", {
          x: pixel.x,
          y: pixel.y,
          color: pixel.color,
        });
      }
    }

    return { success: true, updated: args.pixels.length };
  },
});