"use client";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

/** Upload a file to Convex storage and return its id. Only staff who may attach documents get an upload URL. */
export function useUpload() {
  const gen = useMutation(api.files.generateUploadUrl);
  return async (file: File): Promise<Id<"_storage">> => {
    const url = await gen();
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file });
    if (!res.ok) throw new Error("upload failed");
    const { storageId } = await res.json();
    return storageId as Id<"_storage">;
  };
}
