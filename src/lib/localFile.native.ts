import { File } from "expo-file-system";

export async function readLocalFile(
  uri: string,
): Promise<{ bytes: Uint8Array; type: string }> {
  const file = new File(uri);
  return { bytes: await file.bytes(), type: file.type ?? "" };
}

export async function deleteLocalFile(uri: string): Promise<void> {
  await new File(uri).delete();
}
