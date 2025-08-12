import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

// Helper functions for pixel data compression
const compressPixelData = (pixels: string[]): string => {
  // Simple run-length encoding for repeated colors
  const compressed: string[] = [];
  let currentColor = pixels[0];
  let count = 1;
  
  for (let i = 1; i < pixels.length; i++) {
    if (pixels[i] === currentColor && count < 999) {
      count++;
    } else {
      if (count === 1) {
        compressed.push(currentColor);
      } else {
        compressed.push(`${count}:${currentColor}`);
      }
      currentColor = pixels[i];
      count = 1;
    }
  }
  
  // Don't forget the last group
  if (count === 1) {
    compressed.push(currentColor);
  } else {
    compressed.push(`${count}:${currentColor}`);
  }
  
  return compressed.join('|');
};

const decompressPixelData = (compressed: string, expectedLength: number): string[] => {
  if (!compressed) {
    return new Array(expectedLength).fill('#FFFFFF');
  }
  
  const pixels: string[] = [];
  const parts = compressed.split('|');
  
  for (const part of parts) {
    if (part.includes(':')) {
      const [countStr, color] = part.split(':');
      const count = parseInt(countStr, 10);
      for (let i = 0; i < count; i++) {
        pixels.push(color);
      }
    } else {
      pixels.push(part);
    }
  }
  
  // Ensure we have the exact expected length
  while (pixels.length < expectedLength) {
    pixels.push('#FFFFFF');
  }
  
  return pixels.slice(0, expectedLength);
};

// Get the canvas data with palette from environment variable
export const getCanvas = query({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    const canvas = await ctx.db
      .query("canvas")
      .filter((q) => q.eq(q.field("name"), args.name))
      .first();
    
    if (canvas) {
      // Get palette from environment variable
      const paletteString = process.env.PALETTE;
      let palette: string[] = [];
      
      if (paletteString) {
        try {
          palette = JSON.parse(paletteString);
        } catch (error) {
          console.error("Failed to parse PALETTE environment variable:", error);
          palette = ["#000000", "#FFFFFF"]; // Fallback to basic colors
        }
      }
      
      // Decompress pixel data before returning
      const decompressedPixels = decompressPixelData(canvas.pixels, canvas.size * canvas.size);
      return {
        ...canvas,
        pixels: decompressedPixels,
        palette: palette,
      };
    }
    
    return canvas;
  },
});

// Initialize canvas if it doesn't exist
export const initializeCanvas = mutation({
  args: {
    name: v.string(),
    size: v.number(),
  },
  handler: async (ctx, args) => {
    const existingCanvas = await ctx.db
      .query("canvas")
      .filter((q) => q.eq(q.field("name"), args.name))
      .first();

    if (existingCanvas) {
      return existingCanvas._id;
    }

    // Create initial pixel data (all white) and compress it
    const initialPixels = new Array(args.size * args.size).fill('#FFFFFF');
    const compressedPixels = compressPixelData(initialPixels);

    const canvasId = await ctx.db.insert("canvas", {
      name: args.name,
      size: args.size,
      pixels: compressedPixels,
    });

    return canvasId;
  },
});

// Update a single pixel
export const updatePixel = mutation({
  args: {
    name: v.string(),
    x: v.number(),
    y: v.number(),
    color: v.string(),
  },
  handler: async (ctx, args) => {
    const canvas = await ctx.db
      .query("canvas")
      .filter((q) => q.eq(q.field("name"), args.name))
      .first();

    if (!canvas) {
      throw new Error("Canvas not found");
    }

    // Decompress, update, and recompress
    const pixels = decompressPixelData(canvas.pixels, canvas.size * canvas.size);
    const index = args.y * canvas.size + args.x;
    pixels[index] = args.color;
    const compressedPixels = compressPixelData(pixels);

    await ctx.db.patch(canvas._id, {
      pixels: compressedPixels,
    });

    return { success: true };
  },
});

// Batch update multiple pixels (for potential future use)
export const updatePixels = mutation({
  args: {
    name: v.string(),
    updates: v.array(v.object({
      x: v.number(),
      y: v.number(),
      color: v.string(),
    })),
  },
  handler: async (ctx, args) => {
    const canvas = await ctx.db
      .query("canvas")
      .filter((q) => q.eq(q.field("name"), args.name))
      .first();

    if (!canvas) {
      throw new Error("Canvas not found");
    }

    // Decompress, update, and recompress
    const pixels = decompressPixelData(canvas.pixels, canvas.size * canvas.size);
    
    args.updates.forEach(update => {
      const index = update.y * canvas.size + update.x;
      pixels[index] = update.color;
    });

    const compressedPixels = compressPixelData(pixels);

    await ctx.db.patch(canvas._id, {
      pixels: compressedPixels,
    });

    return { success: true };
  },
});