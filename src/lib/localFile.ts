export async function readLocalFile(
  uri: string,
): Promise<{ bytes: Uint8Array; type: string }> {
  const response = await fetch(uri);
  if (!response.ok) {
    throw new Error(`Could not read the selected file (HTTP ${response.status}).`);
  }
  const blob = await response.blob();
  return {
    bytes: new Uint8Array(await blob.arrayBuffer()),
    type: blob.type,
  };
}

export async function deleteLocalFile(uri: string): Promise<void> {
  if (uri.startsWith("blob:")) URL.revokeObjectURL(uri);
}
