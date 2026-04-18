/**
 * LiteParse — Lightweight text extraction for PDF, TXT, MD files.
 * Uses pdf-parse which works reliably on Vercel serverless.
 *
 * NOTE: docx/xlsx/images require LibreOffice — NOT available on Vercel serverless.
 * Route non-PDF formats to a containerised endpoint if needed.
 *
 * IMPORTANT: pdf-parse v1 has a known issue where it tries to read a test PDF on import.
 * We use a dynamic import workaround to avoid this.
 */

import { Buffer } from 'buffer';

export interface ParseResult {
  text: string;
  success: boolean;
  error?: string;
  pages?: number;
}

/**
 * Parse a file and extract text content.
 * @param content - Buffer/ArrayBuffer/Uint8Array/string of the file data, or raw text for type="text"
 * @param type - "pdf" or "text"
 * @param filename - Filename (used to determine extension for pdf/text/md)
 * @returns ParseResult with extracted text
 */
export async function liteParse(
  content: Buffer | ArrayBuffer | Uint8Array | string,
  type: 'pdf' | 'text',
  filename?: string
): Promise<ParseResult> {
  try {
    // Convert input to Buffer
    let buffer: Buffer;
    if (typeof content === 'string') {
      if (type === 'text') {
        // For text type, the string IS the content
        return {
          text: content.trim(),
          success: true,
        };
      }
      // For PDF, the string is base64-encoded
      buffer = Buffer.from(content, 'base64');
    } else if (content instanceof ArrayBuffer) {
      buffer = Buffer.from(content);
    } else if (content instanceof Uint8Array) {
      buffer = Buffer.from(content);
    } else {
      buffer = content;
    }

    // Determine extension from filename or type
    const ext = filename
      ? filename.toLowerCase().split('.').pop() || ''
      : type === 'pdf'
        ? 'pdf'
        : 'txt';

    if (ext === 'pdf') {
      // Dynamic import to avoid pdf-parse test file loading issue
      const pdfParse = (await import('pdf-parse')).default;
      const data = await pdfParse(buffer);

      let fullText = data.text.trim();

      // Add page separators for better chunking later
      if (data.numpages && data.numpages > 1) {
        fullText = fullText.replace(/\f/g, '\n\n--- Page Break ---\n\n');
      }

      if (!fullText) {
        return {
          text: '',
          success: false,
          error: 'No extractable text found in PDF (possibly scanned/image-only)',
          pages: data.numpages,
        };
      }

      return {
        text: fullText,
        success: true,
        pages: data.numpages,
      };
    } else if (ext === 'txt' || ext === 'md') {
      // Plain text files
      const text = buffer.toString('utf-8');
      return {
        text: text.trim(),
        success: true,
      };
    } else {
      return {
        text: '',
        success: false,
        error: `Format .${ext} is not supported on Vercel serverless. Supported: PDF, TXT, MD.`,
      };
    }
  } catch (err: any) {
    console.error('LiteParse error:', err);
    return {
      text: '',
      success: false,
      error: `Parse failed: ${err.message || 'Unknown error'}`,
    };
  }
}
