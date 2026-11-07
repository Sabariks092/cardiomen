import { z } from 'zod';

/** Shared by the mobile app and the API, so a mismatch fails at compile time rather than in use. */

const email = z.string().trim().toLowerCase().email().max(254);
const password = z.string().min(8).max(128);
const otpCode = z.string().regex(/^\d{6}$/);

export const RegisterBody = z.object({ name: z.string().trim().min(1).max(80), email, password });
export const VerifyOtpBody = z.object({
  email,
  code: otpCode,
  password: z.string().min(1).max(128),
  deviceName: z.string().max(120).optional(),
});
export const ResendOtpBody = z.object({ email, purpose: z.enum(['REGISTER', 'RESET_PASSWORD']) });
export const LoginBody = z.object({ email, password: z.string().min(1).max(128), deviceName: z.string().max(120).optional() });
export const GoogleBody = z.object({ idToken: z.string().min(1).max(8192), deviceName: z.string().max(120).optional() });
export const RefreshBody = z.object({ refreshToken: z.string().min(1).max(256) });
export const ForgotPasswordBody = z.object({ email });
export const ResetPasswordBody = z.object({ email, code: otpCode, password });

export const UserDto = z.object({
  id: z.string().uuid(),
  email: z.string(),
  name: z.string(),
  avatarUrl: z.string().nullable(),
  hasPassword: z.boolean(),
});
export type UserDto = z.infer<typeof UserDto>;

export const AuthResponse = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  user: UserDto,
});
export type AuthResponse = z.infer<typeof AuthResponse>;

export const ActivityTypeDto = z.enum(['walk', 'jog', 'run']);

const finite = z.number().finite();
/** Postgres rejects NUL in text, which would otherwise surface as a server error retried forever. */
const text = (max: number) => z.string().max(max).refine((s) => !s.includes('\0'), 'Contains an invalid character');
const MAX_TIMESTAMP = 4_102_444_800_000; // Year 2100.
const timestamp = finite.int().min(0).max(MAX_TIMESTAMP);
const lat = finite.min(-90).max(90);
const lng = finite.min(-180).max(180);

const realDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((d) => {
    const parsed = new Date(`${d}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === d;
  }, 'Not a real date');

export const MAX_PREVIEW_POINTS = 5000;
export const MAX_PRESET_JSON = 256_000;
export const MAX_SETTINGS_JSON = 16_000;

export const ActivityMeta = z.object({
  type: ActivityTypeDto,
  title: text(80).nullable(),
  note: text(500).nullable(),
  startedAt: timestamp,
  endedAt: timestamp,
  tzOffsetMin: finite.int().min(-840).max(840),
  localDate: realDate,
  activeMs: finite.int().min(0).max(MAX_TIMESTAMP),
  elapsedMs: finite.int().min(0).max(MAX_TIMESTAMP),
  distanceM: finite.min(0).max(2_000_000),
  steps: finite.int().min(0).max(2_000_000).nullable(),
  previewRoute: z
    .array(z.array(z.tuple([lng, lat])))
    .refine((lines) => lines.reduce((n, l) => n + l.length, 0) <= MAX_PREVIEW_POINTS, 'Preview route is too long'),
  bbox: z.object({ minLat: lat, minLng: lng, maxLat: lat, maxLng: lng }).nullable(),
  engineVersion: finite.int().min(1).max(10_000),
  clientUpdatedAt: timestamp,
  deleted: z.boolean(),
});
export type ActivityMeta = z.infer<typeof ActivityMeta>;

export const MAX_TRACK_BASE64 = 4_000_000;

export const PutActivityBody = ActivityMeta.extend({
  // Absent on updates of an activity whose route the server already has.
  track: z
    .object({
      format: z.literal(1),
      base64: z.string().min(1).max(MAX_TRACK_BASE64),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .optional(),
}).refine((a) => a.endedAt >= a.startedAt, { message: 'An activity cannot end before it starts', path: ['endedAt'] });
export type PutActivityBody = z.infer<typeof PutActivityBody>;

export const PutActivityResponse = z.object({ version: z.number(), hasTrack: z.boolean() });

export const ActivityChange = ActivityMeta.extend({
  id: z.string().uuid(),
  version: z.number(),
});
export type ActivityChange = z.infer<typeof ActivityChange>;

export const PresetBody = z.object({
  name: text(80).trim().min(1),
  doc: z.record(z.string(), z.unknown()).refine((d) => JSON.stringify(d).length <= MAX_PRESET_JSON, 'Preset is too large'),
  clientUpdatedAt: timestamp,
  deleted: z.boolean(),
});
export type PresetBody = z.infer<typeof PresetBody>;

export const PresetChange = z.object({
  id: z.string().uuid(),
  version: z.number(),
  name: z.string(),
  doc: z.record(z.string(), z.unknown()),
  clientUpdatedAt: z.number(),
  deleted: z.boolean(),
});
export type PresetChange = z.infer<typeof PresetChange>;

export const ChangesResponse = z.object({
  cursor: z.number(),
  hasMore: z.boolean(),
  activities: z.array(ActivityChange),
  presets: z.array(PresetChange),
});
export type ChangesResponse = z.infer<typeof ChangesResponse>;

export const TrackResponse = z.object({ format: z.number(), base64: z.string(), sha256: z.string() });

export const ErrorBody = z.object({ error: z.object({ code: z.string(), message: z.string() }) });
export type ErrorBody = z.infer<typeof ErrorBody>;
