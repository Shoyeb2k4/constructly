import { z } from "zod";

const optionalText = (max: number) =>
  z.string().trim().max(max).nullish().or(z.literal("").transform(() => null));

export const companyProfileSchema = z.object({
  name: z.string().trim().min(1, "Company name is required").max(120).optional(),
  legalName: optionalText(160),
  gstin: optionalText(20),
  pan: optionalText(15),
  cin: optionalText(30),
  addressLine: optionalText(240),
  city: optionalText(80),
  state: optionalText(80),
  country: optionalText(80),
  pincode: optionalText(12),
  phone: optionalText(20),
  email: z
    .string()
    .trim()
    .email("Enter a valid email")
    .max(160)
    .nullish()
    .or(z.literal("").transform(() => null)),
  website: optionalText(200),
});

export const brandColorsSchema = z.object({
  primary: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullish(),
  secondary: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullish(),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullish(),
  success: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullish(),
  warning: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullish(),
  danger: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullish(),
});

export const profileSchema = z.object({
  fullName: z.string().trim().min(1, "Name is required").max(120).optional(),
  designation: optionalText(80),
  phone: optionalText(20),
  theme: z.enum(["light", "dark", "system"]).nullish(),
  language: optionalText(12),
  timezone: optionalText(48),
});

export const assetKindSchema = z.enum([
  "logo",
  "squareLogo",
  "darkLogo",
  "lightLogo",
  "favicon",
  "stamp",
  "signature",
  "photo",
]);
