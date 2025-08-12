import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  canvas: defineTable({
    name: v.string(),
    size: v.number(),
    palette: v.array(v.string()),
    pixels: v.string(), // Store as compressed string instead of array
  }),
});