/**
 * Encodes a string in base64 representing the string in UTF-8.
 * @param str
 */
export function encodeBase64(str: string): string {
  return btoa(
    encodeURIComponent(str).replace(
      /%([0-9A-F]{2})/g,
      function toSolidBytes(_, p1) {
        return String.fromCharCode(Number(`0x${p1}`));
      },
    ),
  )
    .replaceAll("=", "")
    .replaceAll("+", "-")
    .replaceAll("/", "_");
}
