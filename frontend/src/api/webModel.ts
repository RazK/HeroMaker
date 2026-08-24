/**
 * The filename to request for a model that is only going to be looked at.
 *
 * The backend keeps a `web_` copy of every GLB/VRM with the texture re-encoded
 * and the skinning attributes packed - 7.4 MB down to 1.5 MB on a production
 * avatar, same mesh, same skeleton, same animation. Downloading the full-size
 * original is what left the 3D stage empty for seconds on a phone.
 *
 * Only for previewing. Downloads and the KalidoFace share link must keep using
 * the original: its texture is re-encoded as WebP without declaring
 * EXT_texture_webp, which every browser reads but a strict glTF consumer may
 * not.
 */
export function webModel(filename: string): string {
  return /\.(glb|vrm)$/i.test(filename) ? `web_${filename}` : filename;
}
