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

// Helper function to resize pixel data from top-left
const resizePixelData = (
  oldPixels: string[], 
  oldWidth: number, 
  oldHeight: number, 
  newWidth: number, 
  newHeight: number
): string[] => {
  const newPixels = new Array(newWidth * newHeight).fill('#FFFFFF');
  
  // Copy existing pixels from top-left
  const copyWidth = Math.min(oldWidth, newWidth);
  const copyHeight = Math.min(oldHeight, newHeight);
  
  for (let y = 0; y < copyHeight; y++) {
    for (let x = 0; x < copyWidth; x++) {
      const oldIndex = y * oldWidth + x;
      const newIndex = y * newWidth + x;
      newPixels[newIndex] = oldPixels[oldIndex];
    }
  }
  
  return newPixels;
};

// Helper function to extract size from compressed pixel data
// We'll store size info in the compressed string format: "width,height|compressed_data"
const extractSizeFromCompressed = (compressedWithSize: string): { width: number; height: number; compressed: string } => {
  const parts = compressedWithSize.split('|');
  if (parts.length < 2) {
    // Fallback for old format - assume square based on pixel count
    const pixels = decompressPixelData(compressedWithSize, 0);
    const size = Math.sqrt(pixels.length);
    return { width: size, height: size, compressed: compressedWithSize };
  }
  
  const [width, height] = parts[0].split(',').map(s => parseInt(s, 10));
  const compressed = parts.slice(1).join('|');
  return { width, height, compressed };
};

// Helper function to add size info to compressed data
const addSizeToCompressed = (compressed: string, width: number, height: number): string => {
  return `${width},${height}|${compressed}`;
};

// Get the palette
export const getPaletteColors = query({
  args: {},
  handler: async () => {
    return getPalette();
  },
});

// Get the canvas data (READ-ONLY)
export const getCanvas = query({
  args: {},
  handler: async (ctx) => {
    const { width, height } = getSize();
    const canvas = await ctx.db
      .query("canvas")
      .first();
    
    if (canvas) {
      // Extract size and compressed data
      const { width: storedWidth, height: storedHeight, compressed } = extractSizeFromCompressed(canvas.pixels);
      
      // Check if resize is needed - but don't modify in a query!
      if (storedWidth !== width || storedHeight !== height) {
        // Return indication that resize is needed
        const oldPixels = decompressPixelData(compressed, storedWidth * storedHeight);
        const newPixels = resizePixelData(oldPixels, storedWidth, storedHeight, width, height);
        
        return {
          width,
          height,
          pixels: newPixels,
          palette: getPalette(),
          needsResize: true, // Indicate that a resize mutation should be called
        };
      }
      
      // No resize needed, decompress and return
      const decompressedPixels = decompressPixelData(compressed, width * height);
      return {
        width,
        height,
        pixels: decompressedPixels,
        palette: getPalette(),
        needsResize: false,
      };
    }
    
    return null;
  },
});

// NEW: Separate mutation to handle resizing
export const resizeCanvas = mutation({
  args: {},
  handler: async (ctx) => {
    const { width, height } = getSize();
    const canvas = await ctx.db
      .query("canvas")
      .first();
    
    if (!canvas) {
      throw new Error("Canvas not found");
    }
    
    // Extract size and compressed data
    const { width: storedWidth, height: storedHeight, compressed } = extractSizeFromCompressed(canvas.pixels);
    
    // Only resize if needed
    if (storedWidth !== width || storedHeight !== height) {
      // Decompress old pixels
      const oldPixels = decompressPixelData(compressed, storedWidth * storedHeight);
      
      // Resize from top-left
      const newPixels = resizePixelData(oldPixels, storedWidth, storedHeight, width, height);
      
      // Compress and update
      const newCompressed = compressPixelData(newPixels);
      const newCompressedWithSize = addSizeToCompressed(newCompressed, width, height);
      
      await ctx.db.patch(canvas._id, {
        pixels: newCompressedWithSize,
      });
      
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
    const existingCanvas = await ctx.db
      .query("canvas")
      .first();

    if (existingCanvas) {
      return existingCanvas._id;
    }

    // Create initial pixel data (all white) and compress it
    const initialPixels = new Array(width * height).fill('#FFFFFF');
    const compressedPixels = compressPixelData(initialPixels);
    const compressedWithSize = addSizeToCompressed(compressedPixels, width, height);

    const canvasId = await ctx.db.insert("canvas", {
      pixels: compressedWithSize,
    });

    return canvasId;
  },
});

// Update a single pixel
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
    const canvas = await ctx.db
      .query("canvas")
      .first();

    if (!canvas) {
      throw new Error("Canvas not found");
    }

    // Extract size and compressed data
    const { compressed } = extractSizeFromCompressed(canvas.pixels);
    
    // Decompress, update, and recompress
    const pixels = decompressPixelData(compressed, width * height);
    const index = args.y * width + args.x;
    
    if (index >= 0 && index < pixels.length) {
      pixels[index] = args.color;
      const compressedPixels = compressPixelData(pixels);
      const compressedWithSize = addSizeToCompressed(compressedPixels, width, height);

      await ctx.db.patch(canvas._id, {
        pixels: compressedWithSize,
      });
    }

    return { success: true };
  },
});