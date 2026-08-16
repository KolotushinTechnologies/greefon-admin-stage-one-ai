export function chunkDocument(title: string, body: string): string[] {
  const prepared = body.replace(/\r\n/g, "\n").trim();
  if (!prepared) {
    return [`${title}`];
  }
  const sections = prepared.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  const chunks: string[] = [];
  let buffer = "";

  const push = (text: string) => {
    const value = text.trim();
    if (value.length > 0) {
      chunks.push(`${title}\n${value}`);
    }
  };

  for (const section of sections) {
    if ((buffer + "\n\n" + section).length > 700 && buffer.length > 0) {
      push(buffer);
      buffer = section;
      continue;
    }
    buffer = buffer.length > 0 ? `${buffer}\n\n${section}` : section;
  }
  if (buffer.length > 0) {
    push(buffer);
  }
  return chunks.length > 0 ? chunks : [`${title}\n${prepared}`];
}
