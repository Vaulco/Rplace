import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  pixels: defineTable({
    x: v.number(),
    y: v.number(),
    color: v.string(),
  }).index("by_coordinates", ["x", "y"]),
  
  canvas_config: defineTable({
    width: v.number(),
    height: v.number(),
    initialized: v.boolean(),
  }),
});