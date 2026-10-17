// Téléchargements générés côté navigateur (exports de l'Explorer et des sous-graphes).
export function downloadFile(content: string, fileName: string, mimeType: string) {
  // Le BOM permet à Excel de lire correctement les accents des CSV.
  const parts = mimeType.startsWith('text/csv') ? ['﻿', content] : [content];
  const url = URL.createObjectURL(new Blob(parts, { type: mimeType }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

export function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : Array.isArray(value) ? value.join(' | ') : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
}

export function fileSlug(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'export';
}
