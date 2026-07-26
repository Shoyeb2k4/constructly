"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  getCompanyBranding,
  updateCompanyProfile,
  updateBrandColors,
  getProfile,
  updateProfile,
  getBrandingAssetUrls,
  getProfileAssetUrls,
  removeBrandingAsset,
} from "./server/actions";
import { uploadBrandingAsset } from "./upload";
import type { BrandAssetKind, BrandColors, CompanyProfileInput, ProfileInput } from "./types";

export const brandingKeys = {
  company: ["branding", "company"] as const,
  assets: ["branding", "assets"] as const,
  profile: ["branding", "profile"] as const,
  profileAssets: ["branding", "profile-assets"] as const,
};

export function useCompanyBranding() {
  return useQuery({ queryKey: brandingKeys.company, queryFn: () => getCompanyBranding() });
}
export function useBrandingAssetUrls() {
  return useQuery({
    queryKey: brandingKeys.assets,
    queryFn: () => getBrandingAssetUrls(),
    staleTime: 50 * 60_000, // under the 1h signed-URL TTL
  });
}
export function useProfile() {
  return useQuery({ queryKey: brandingKeys.profile, queryFn: () => getProfile() });
}
export function useProfileAssetUrls() {
  return useQuery({
    queryKey: brandingKeys.profileAssets,
    queryFn: () => getProfileAssetUrls(),
    staleTime: 50 * 60_000,
  });
}

export function useUpdateCompanyProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CompanyProfileInput) => updateCompanyProfile(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: brandingKeys.company });
      toast.success("Company details saved");
    },
    onError: () => toast.error("Couldn't save company details"),
  });
}

export function useUpdateBrandColors() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (colors: BrandColors) => updateBrandColors(colors),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: brandingKeys.company });
      toast.success("Brand colors saved");
    },
    onError: () => toast.error("Couldn't save colors"),
  });
}

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ProfileInput) => updateProfile(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: brandingKeys.profile });
      toast.success("Profile saved");
    },
    onError: () => toast.error("Couldn't save profile"),
  });
}

export function useUploadAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ kind, file }: { kind: BrandAssetKind; file: File }) =>
      uploadBrandingAsset(kind, file),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: brandingKeys.assets });
      qc.invalidateQueries({ queryKey: brandingKeys.profileAssets });
      qc.invalidateQueries({ queryKey: brandingKeys.company });
      qc.invalidateQueries({ queryKey: brandingKeys.profile });
      toast.success("Uploaded");
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Upload failed"),
  });
}

export function useRemoveAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (kind: BrandAssetKind) => removeBrandingAsset(kind),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: brandingKeys.assets });
      qc.invalidateQueries({ queryKey: brandingKeys.profileAssets });
      qc.invalidateQueries({ queryKey: brandingKeys.company });
      qc.invalidateQueries({ queryKey: brandingKeys.profile });
      toast.success("Removed");
    },
    onError: () => toast.error("Couldn't remove"),
  });
}
