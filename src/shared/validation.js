const { z } = require("zod");

const Bounds = z.object({
  x: z.number().int().min(-100000).max(100000),
  y: z.number().int().min(-100000).max(100000),
  width: z.number().int().positive().max(20000),
  height: z.number().int().positive().max(20000)
}).strict();

const ControlConfig = z.object({
  enabled: z.boolean(),
  bounds: Bounds.nullable().optional()
}).strict();

const RemoteInput = z.discriminatedUnion("type", [
  z.object({ type: z.literal("mousemove"), x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).strict(),
  z.object({ type: z.enum(["mousedown", "mouseup"]), x: z.number().min(0).max(1), y: z.number().min(0).max(1), button: z.number().int().min(0).max(2) }).strict(),
  z.object({ type: z.literal("wheel"), x: z.number().min(0).max(1), y: z.number().min(0).max(1), deltaY: z.number().finite().min(-10000).max(10000) }).strict(),
  z.object({ type: z.enum(["keydown", "keyup"]), x: z.number().min(0).max(1).optional(), y: z.number().min(0).max(1).optional(), key: z.string().min(1).max(40), code: z.string().max(40).optional(), ctrl: z.boolean().optional(), shift: z.boolean().optional(), alt: z.boolean().optional(), meta: z.boolean().optional() }).strict()
]);

const SaveFile = z.object({
  name: z.string().min(1).max(200).transform((name) => name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")),
  data: z.union([z.instanceof(ArrayBuffer), z.instanceof(Uint8Array)])
}).strict();

const SessionCode = z.string().regex(/^\d{9}$/);
const Permissions = z.object({
  control: z.boolean().default(false),
  mouse: z.boolean().default(false),
  keyboard: z.boolean().default(false),
  clipboard: z.boolean().default(false),
  files: z.boolean().default(false),
  audio: z.boolean().default(false)
}).strict();

const SessionDuration = z.number().int().min(0).max(7 * 24 * 60).default(0);

module.exports = { Bounds, ControlConfig, RemoteInput, SaveFile, SessionCode, Permissions, SessionDuration };
