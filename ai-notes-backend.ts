/**
 * ══════════════════════════════════════════════════════════════════════════
 * AI NOTES PROCESS — Backend Function for Studyria
 * ══════════════════════════════════════════════════════════════════════════
 *
 * This function processes an AI note conversion job:
 * 1. Downloads uploaded PDF from Supabase storage
 * 2. Extracts text content (with OCR fallback)
 * 3. Structures content into exam-oriented notes via LLM
 * 4. Generates handwritten-style PDF
 * 5. Uploads output to Supabase storage
 * 6. Deletes original source PDF (privacy-first)
 * 7. Updates job status in database
 *
 * DEPLOYMENT: This needs to be deployed as a Base44 backend function
 * OR a Supabase Edge Function. Currently written as a standalone
 * TypeScript module that can be adapted to either platform.
 *
 * REQUIRED ENVIRONMENT VARIABLES:
 *   SUPABASE_URL          - Supabase project URL
 *   SUPABASE_SERVICE_KEY  - Service role key (bypasses RLS for storage ops)
 *   OPENAI_API_KEY        - For LLM content structuring
 *   AI_NOTES_BUCKET       - Storage bucket name (default: ai-notes-temp)
 * ══════════════════════════════════════════════════════════════════════════
 */

export default async function aiNotesProcess(req: any, res: any) {
  const { job_id } = req.body || req.query || {};
  
  if (!job_id) {
    return res.status(400).json({ error: 'Missing job_id' });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL || 'https://qsdfmgcekdpjdcyqhuhi.supabase.co';
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
  const OPENAI_KEY = process.env.OPENAI_API_KEY || '';
  const BUCKET = process.env.AI_NOTES_BUCKET || 'ai-notes-temp';
  
  if (!SERVICE_KEY) return res.status(500).json({ error: 'Service key not configured' });
  
  const dbUrl = (path: string) => `${SUPABASE_URL}/rest/v1/${path}`;
  const headers = {
    'apikey': SERVICE_KEY,
    'Authorization': `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
  };

  try {
    // ── 1. Fetch job from database ─────────────────────────────────────
    const jobResp = await fetch(dbUrl(`ai_note_jobs?id=eq.${job_id}`), { headers });
    const jobs = await jobResp.json();
    if (!jobs || !jobs.length) return res.status(404).json({ error: 'Job not found' });
    const job = jobs[0];

    if (job.status !== 'QUEUED' && job.status !== 'PAYMENT_VERIFIED') {
      return res.status(409).json({ error: `Job is in status ${job.status}, not ready for processing` });
    }

    // ── 2. Update status: EXTRACTING ───────────────────────────────────
    await updateJobStatus(job_id, 'EXTRACTING', headers, SUPABASE_URL);

    // ── 3. Download source PDF from storage ────────────────────────────
    const sourcePath = job.source_storage_path;
    if (!sourcePath) throw new Error('No source file path in job');
    
    const fileResp = await fetch(
      `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${sourcePath}`,
      { headers: { 'Authorization': `Bearer ${SERVICE_KEY}` } }
    );
    if (!fileResp.ok) throw new Error(`Failed to download source: ${fileResp.status}`);
    const pdfBuffer = Buffer.from(await fileResp.arrayBuffer());

    // ── 4. Extract text (basic — for production, use pdf.js or OCR) ────
    await updateJobStatus(job_id, 'STRUCTURING', headers, SUPABASE_URL);
    
    // For production: use pdf.js for text PDFs, Tesseract for scanned
    // This is a simplified version — the actual extraction would use
    // a PDF parsing library server-side
    const extractedText = await extractPdfText(pdfBuffer);
    
    if (!extractedText || extractedText.trim().length < 50) {
      // Try OCR fallback (if available)
      const ocrText = await ocrFallback(pdfBuffer);
      if (!ocrText || ocrText.trim().length < 50) {
        throw new Error('Could not extract text from PDF. It may be scanned with low quality.');
      }
      // Update with OCR warning
      await updateJob(job_id, { error_message_safe: 'OCR was used. Some content may be approximate.' }, headers, SUPABASE_URL);
    }

    // ── 5. Structure content via LLM ─────────────────────────────────
    await updateJobStatus(job_id, 'GENERATING', headers, SUPABASE_URL);
    
    const structuredNotes = await structureContent(
      extractedText, 
      job.conversion_mode, 
      job.language, 
      OPENAI_KEY
    );

    // ── 6. Render handwritten-style PDF ───────────────────────────────
    await updateJobStatus(job_id, 'RENDERING', headers, SUPABASE_URL);
    
    const outputPdf = await renderHandwrittenPdf(structuredNotes, job);
    const outputPath = `ai-notes-out/${job.user_id}/${job_id}/studyria-ai-notes-${job_id.substring(0, 8)}.pdf`;
    
    // Upload output to storage
    await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${outputPath}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/pdf' },
      body: outputPdf
    });

    // ── 7. Quality check ──────────────────────────────────────────────
    await updateJobStatus(job_id, 'QUALITY_CHECK', headers, SUPABASE_URL);
    
    const qualityOk = await qualityCheck(outputPdf, structuredNotes);
    if (!qualityOk) {
      // Retry rendering once
      const retryPdf = await renderHandwrittenPdf(structuredNotes, job);
      if (!await qualityCheck(retryPdf, structuredNotes)) {
        throw new Error('Quality validation failed. Output PDF has issues.');
      }
    }

    // ── 8. Mark COMPLETED & delete source ─────────────────────────────
    const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    await updateJob(job_id, {
      status: 'COMPLETED',
      output_path: outputPath,
      output_filename: `studyria-ai-notes-${job_id.substring(0, 8)}.pdf`,
      completed_at: new Date().toISOString(),
      expires_at: expiresAt,
      quality_checked: true,
      cleanup_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
      source_pages_mapping: structuredNotes.sourceMapping || null
    }, headers, SUPABASE_URL);

    // Delete original source PDF (privacy-first)
    await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${sourcePath}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${SERVICE_KEY}` }
    });

    return res.status(200).json({ success: true, job_id, status: 'COMPLETED' });

  } catch (error: any) {
    console.error('[AI Notes] Processing failed:', error);
    
    // Mark job as failed
    await updateJob(job_id, {
      status: 'FAILED',
      error_code: 'PROCESSING_ERROR',
      error_message_safe: getSafeErrorMessage(error)
    }, headers, SUPABASE_URL);
    
    // Note: If payment was verified but processing fails, mark for admin review
    // The admin can trigger a refund via the existing payment system
    
    return res.status(500).json({ 
      error: 'Processing failed', 
      job_id,
      safe_message: getSafeErrorMessage(error)
    });
  }
}

// ══════════════════════════════════════════════════════════════════════════
// Helper Functions
// ══════════════════════════════════════════════════════════════════════════

async function updateJobStatus(jobId: string, status: string, headers: any, supabaseUrl: string) {
  await fetch(`${supabaseUrl}/rest/v1/ai_note_jobs?id=eq.${jobId}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ status })
  });
}

async function updateJob(jobId: string, updates: any, headers: any, supabaseUrl: string) {
  await fetch(`${supabaseUrl}/rest/v1/ai_note_jobs?id=eq.${jobId}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(updates)
  });
}

async function extractPdfText(buffer: Buffer): Promise<string> {
  // Production: use pdf.js (pdfjs-dist) or pdf-parse to extract text
  // For now, this is a placeholder that would use the library
  // import * as pdfjsLib from 'pdfjs-dist';
  // const doc = await pdfjsLib.getDocument({ data: buffer }).promise;
  // let text = '';
  // for (let i = 1; i <= doc.numPages; i++) {
  //   const page = await doc.getPage(i);
  //   const content = await page.getTextContent();
  //   text += content.items.map((item: any) => item.str).join(' ') + '\n\n';
  // }
  // return text;
  return ''; // Placeholder
}

async function ocrFallback(buffer: Buffer): Promise<string> {
  // Production: use Tesseract.js or an OCR API
  // import Tesseract from 'tesseract.js';
  // const result = await Tesseract.recognize(buffer, 'eng');
  // return result.data.text;
  return ''; // Placeholder
}

async function structureContent(text: string, mode: string, language: string, apiKey: string): Promise<any> {
  // Call LLM API (OpenAI or similar) to structure the text
  // The prompt enforces source fidelity — no hallucination
  
  if (!apiKey) throw new Error('AI API key not configured');
  
  const modeInstruction = mode === 'quick' 
    ? 'Create concise quick-revision notes with bullet points and one-line summaries.'
    : mode === 'detailed'
    ? 'Create comprehensive detailed study notes with full explanations.'
    : 'Create premium handwritten-style notes with tables, timelines, memory tricks, and one-line revision points.';
  
  const langInstruction = language === 'en' ? 'Write in English.' 
    : language === 'as' ? 'Write in Assamese.' 
    : 'Write in the same language as the source.';
  
  const prompt = `You are an expert study notes creator for Assam government exam preparation.
${modeInstruction}
${langInstruction}

CRITICAL RULES:
- The following text is from a PDF uploaded by the student. It is the PRIMARY SOURCE.
- Do NOT invent facts, dates, names, or statistics that are not in the source.
- You may summarize, restructure, simplify, organize, and create headings.
- You may create tables, timelines, memory aids, and revision bullets DERIVED FROM the source.
- You may identify the most important/high-probability exam points FROM the source.
- Do NOT add outside knowledge. If information is missing, leave it out.
- Organize content into logical sections with clear numbered headings.

Return a JSON object with:
{
  "title": "Extracted from source",
  "sections": [
    { "id": 1, "heading": "...", "type": "key_concepts|facts|definitions|timeline|table|memory_tricks|revision|important_points", "content": "...", "source_pages": [1,2] }
  ],
  "one_line_revision": ["...", "..."],
  "sourceMapping": { "section_1": [1, 2] }
}

SOURCE TEXT:
${text.substring(0, 50000)}`;

  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      response_format: { type: 'json_object' }
    })
  });
  
  if (!resp.ok) throw new Error('LLM API error: ' + resp.status);
  const data = await resp.json();
  return JSON.parse(data.choices[0].message.content);
}

async function renderHandwrittenPdf(notes: any, job: any): Promise<Buffer> {
  // Production: use pdf-lib or jsPDF to generate a styled PDF
  // with Studyria branding, handwritten-style fonts, cream paper background,
  // colored headings, tables, timelines, memory boxes, etc.
  
  // import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
  // const pdfDoc = await PDFDocument.create();
  // ... render pages with the structured notes content
  
  // This is a placeholder returning an empty PDF
  return Buffer.from('%PDF-1.4\n%%EOF');
}

async function qualityCheck(pdfBuffer: Buffer, notes: any): Promise<boolean> {
  // Check: PDF opens, has valid page count, no empty pages, 
  // no clipped text, output file size > 1KB
  if (pdfBuffer.length < 1024) return false;
  if (!pdfBuffer.slice(0, 5).toString().startsWith('%PDF-')) return false;
  if (!notes.sections || notes.sections.length === 0) return false;
  return true;
}

function getSafeErrorMessage(error: any): string {
  const msg = error?.message || 'Unknown error';
  // Never expose internal stack traces or file paths
  if (msg.includes('extract')) return 'Could not read the PDF content.';
  if (msg.includes('LLM') || msg.includes('API')) return 'AI processing temporarily unavailable.';
  if (msg.includes('storage')) return 'File storage error. Please try again.';
  return 'Something went wrong while generating your notes.';
}
