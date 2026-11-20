import { useLayoutEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Dropzone } from "./files/dropzone";

// Keep the named multipart field for submission and for browsers without JS.
function ServiceKeyUpload({ field }: { field: HTMLInputElement }) {
  const [file, setFile] = useState<File | undefined>(field.files?.[0]);
  useLayoutEffect(() => {
    field.hidden = true;
    field.form!.querySelector<HTMLButtonElement>("button[type=submit]")!.disabled = !file;
  }, [file, field]);

  function select(files: File[]) {
    const selection = new DataTransfer();
    selection.items.add(files[0]);
    field.files = selection.files;
    setFile(files[0]);
  }

  return <Dropzone onFiles={select} accept=".json,application/json" multiple={false}
    title={file ? file.name : "Drop your service key here"}
    hint={file ? "Click to choose a different file" : "or click to choose a JSON file"} />;
}

const slot = document.getElementById("key-upload");
const field = document.getElementById("key");
if (slot && field instanceof HTMLInputElement) {
  createRoot(slot).render(<ServiceKeyUpload field={field} />);
}
