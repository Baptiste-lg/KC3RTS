// Keep the seed and visible order state in the public Actions annotation,
// even when downloading full job logs requires authentication.
export function smokeFailureAnnotation(error, state, diagnostics = null) {
  const context = state ? `\nBrowser state: ${JSON.stringify(state)}` : "";
  const navigation = diagnostics ? `\nBrowser navigation: ${JSON.stringify(diagnostics)}` : "";
  const message = `${String(error)}${context}${navigation}`
    .replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
  return `::error title=Browser smoke failure::${message}`;
}
