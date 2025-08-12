import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

const DEFAULT_PIXEL_COLOR = '#FFFFFF';
const MAX_RUN_LENGTH = 999;
const COMPRESSION_DELIMITER = '|';
const COUNT_SEPARATOR = ':';

export function readPalette(): string[] {
  const paletteString = process.env.CANVAS_PALETTE;
  
  if (!paletteString) {
    throw new Error("CANVAS_PALETTE environment variable is not set");
  }
  
  try {
    const palette = JSON.parse(paletteString);
    
    if (!Array.isArray(palette) || palette.length === 0) {
      throw new Error("CANVAS_PALETTE must be a non-empty array of color strings");
    }
    
    return palette;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error("Invalid CANVAS_PALETTE format - must be valid JSON array of color strings");
    }
    throw error;
  }
}

export function readCanvasSize(): number {
  const sizeString = process.env.CANVAS_SIZE;
  
  if (!sizeString) {
    throw new Error("CANVAS_SIZE environment variable is not set");
  }
  
  const size = parseInt(sizeString, 10);
  
  if (isNaN(size) || size <= 0 || size > 1000) {
    throw new Error("CANVAS_SIZE must be a number between 1 and 1000");
  }
  
  return size;
}

const compressPixelData = (pixels: string[]): string => {
  if (pixels.length === 0) return '';
  
  const compressed: string[] = [];
  let currentColor = pixels[0];
  let count = 1;
  
  for (let i = 1; i < pixels.length; i++) {
    if (pixels[i] === currentColor && count < MAX_RUN_LENGTH) {
      count++;
    } else {
      compressed.push(count === 1 ? currentColor : `${count}${COUNT_SEPARATOR}${currentColor}`);
      currentColor = pixels[i];
      count = 1;
    }
  }
  
  compressed.push(count === 1 ? currentColor : `${count}${COUNT_SEPARATOR}${currentColor}`);
  
  return compressed.join(COMPRESSION_DELIMITER);
};

const decompressPixelData = (compressed: string, expectedLength: number): string[] => {
  if (!compressed) {
    return new Array(expectedLength).fill(DEFAULT_PIXEL_COLOR);
  }
  
  const pixels: string[] = [];
  const parts = compressed.split(COMPRESSION_DELIMITER);
  
  for (const part of parts) {
    if (part.includes(COUNT_SEPARATOR)) {
      const [countStr, color] = part.split(COUNT_SEPARATOR, 2);
      const count = parseInt(countStr, 10);
      
      if (isNaN(count) || count <= 0) {
        throw new Error(`Invalid compression format: invalid count ${countStr}`);
      }
      
      for (let i = 0; i < count; i++) {
        pixels.push(color);
      }
    } else {
      pixels.push(part);
    }
  }
  
  while (pixels.length < expectedLength) {
    pixels.push(DEFAULT_PIXEL_COLOR);
  }
  
  return pixels.slice(0, expectedLength);
};

const validateCoordinates = (x: number, y: number, size: number): void => {
  if (x < 0 || x >= size || y < 0 || y >= size) {
    throw new Error(`Coordinates (${x}, ${y}) are outside canvas bounds (${size}x${size})`);
  }
};

const validateColor = (color: string, palette: string[]): void => {
  if (!palette.includes(color)) {
    throw new Error(`Invalid color: ${color} not in palette`);
  }
};

export const getPalette = query({
  args: {},
  handler: async () => {
    return readPalette();
  },
});

export const getCanvas = query({
  args: {},
  handler: async (ctx) => {
    const size = readCanvasSize();
    
    // Get the first (and presumably only) canvas
    const canvas = await ctx.db
      .query("canvas")
      .first();

    if (!canvas) {
      return null;
    }

    return {
      size,
      pixels: decompressPixelData(canvas.pixels, size * size),
      palette: readPalette(),
    };
  },
});

export const initializeCanvas = mutation({
  args: {},
  handler: async (ctx) => {
    const size = readCanvasSize();

    // Check if a canvas already exists
    const existingCanvas = await ctx.db
      .query("canvas")
      .first();

    if (existingCanvas) {
      return existingCanvas._id;
    }

    const initialPixels = new Array(size * size).fill(DEFAULT_PIXEL_COLOR);
    const compressedPixels = compressPixelData(initialPixels);

    const canvasId = await ctx.db.insert("canvas", {
      pixels: compressedPixels,
    });

    return canvasId;
  },
});

export const updatePixel = mutation({
  args: {
    x: v.number(),
    y: v.number(),
    color: v.string(),
  },
  handler: async (ctx, { x, y, color }) => {
    const size = readCanvasSize();
    
    const canvas = await ctx.db
      .query("canvas")
      .first();

    if (!canvas) {
      throw new Error("Canvas not found");
    }

    validateCoordinates(x, y, size);
    validateColor(color, readPalette());

    const pixels = decompressPixelData(canvas.pixels, size * size);
    const pixelIndex = y * size + x;
    pixels[pixelIndex] = color;

    await ctx.db.patch(canvas._id, {
      pixels: compressPixelData(pixels),
    });

    return { success: true };
  },
});

export const updatePixels = mutation({
  args: {
    updates: v.array(v.object({
      x: v.number(),
      y: v.number(),
      color: v.string(),
    })),
  },
  handler: async (ctx, { updates }) => {
    if (updates.length === 0) {
      return { success: true };
    }

    const size = readCanvasSize();
    
    const canvas = await ctx.db
      .query("canvas")
      .first();

    if (!canvas) {
      throw new Error("Canvas not found");
    }

    const palette = readPalette();

    for (const update of updates) {
      validateCoordinates(update.x, update.y, size);
      validateColor(update.color, palette);
    }

    const pixels = decompressPixelData(canvas.pixels, size * size);
    
    for (const update of updates) {
      const pixelIndex = update.y * size + update.x;
      pixels[pixelIndex] = update.color;
    }

    await ctx.db.patch(canvas._id, {
      pixels: compressPixelData(pixels),
    });

    return { success: true };
  },
});