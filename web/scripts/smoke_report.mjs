// Keep the seed and visible order state in the public Actions annotation,
// even when downloading full job logs requires authentication.
export function smokeFailureAnnotation(error, state) {
  const context = state ? `\nBrowser state: ${JSON.stringify(state)}` : "";
  const message = `${String(error)}${context}`
    .replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
  return `::error title=Browser smoke failure::${message}`;
}
