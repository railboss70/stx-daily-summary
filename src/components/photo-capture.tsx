import { Camera, ImagePlus, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { compressImageFile } from "@/lib/photo-db";
import type { Photo } from "@/lib/types";
import { uid } from "@/lib/utils";

const MAX_PHOTOS = 6;
const MIN_PHOTOS = 3;

export function PhotoCapture({
  photos,
  onChange,
}: {
  photos: Photo[];
  onChange: (photos: Photo[]) => void;
}) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const addFiles = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    const remaining = MAX_PHOTOS - photos.length;
    if (remaining <= 0) {
      toast.error("Maximum of 6 photos.");
      return;
    }
    setBusy(true);
    try {
      const next = [...photos];
      const files = Array.from(list).slice(0, remaining);
      for (const file of files) {
        if (!file.type.startsWith("image/")) continue;
        const dataUrl = await compressImageFile(file);
        next.push({
          id: uid(),
          dataUrl,
          caption: "",
          takenAt: new Date().toISOString(),
        });
      }
      onChange(next);
    } catch {
      toast.error("Could not add that photo. Try another one.");
    } finally {
      setBusy(false);
      if (cameraRef.current) cameraRef.current.value = "";
      if (libraryRef.current) libraryRef.current.value = "";
    }
  };

  const remove = (id: string) => onChange(photos.filter((p) => p.id !== id));
  const caption = (id: string, value: string) =>
    onChange(photos.map((p) => (p.id === id ? { ...p, caption: value } : p)));

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Add 3 or 4 job-site photos. They go out with the report.
        {photos.length < MIN_PHOTOS
          ? ` ${MIN_PHOTOS - photos.length} more needed.`
          : ` ${photos.length} attached.`}
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Button
          type="button"
          size="lg"
          disabled={busy || photos.length >= MAX_PHOTOS}
          onClick={() => cameraRef.current?.click()}
        >
          <Camera />
          Take photo
        </Button>
        <Button
          type="button"
          variant="outline"
          size="lg"
          disabled={busy || photos.length >= MAX_PHOTOS}
          onClick={() => libraryRef.current?.click()}
        >
          <ImagePlus />
          Library
        </Button>
      </div>
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => void addFiles(e.target.files)}
      />
      <input
        ref={libraryRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => void addFiles(e.target.files)}
      />

      {photos.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {photos.map((photo, index) => (
            <li key={photo.id} className="overflow-hidden rounded-lg bg-card shadow-card">
              <div className="relative">
                <img
                  src={photo.dataUrl}
                  alt={photo.caption || `Job photo ${index + 1}`}
                  className="h-44 w-full object-cover outline outline-1 -outline-offset-1 outline-navy/10"
                />
                <button
                  type="button"
                  onClick={() => remove(photo.id)}
                  className="absolute top-2 right-2 flex size-11 items-center justify-center rounded-md bg-navy/80 text-paper-bright"
                  aria-label={`Remove photo ${index + 1}`}
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
              <div className="p-3">
                <Input
                  value={photo.caption}
                  onChange={(e) => caption(photo.id, e.target.value)}
                  placeholder={`Caption for photo ${index + 1} (optional)`}
                  aria-label={`Caption for photo ${index + 1}`}
                />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="rounded-lg border border-dashed border-border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
          No photos yet. Take a shot of the work, materials, or closeout.
        </div>
      )}
    </div>
  );
}
