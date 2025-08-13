import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  canvas: defineTable({
    pixels: v.string(), // Store as compressed string instead of array
  }),
});