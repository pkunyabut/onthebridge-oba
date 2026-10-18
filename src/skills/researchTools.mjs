import { callAI } from '../adapters/index.mjs';

// Standalone helpers used by the "Research tools" tab. They are advisory: nothing here feeds the article pipeline.

// ─── 1. Assess the credibility of a source ───────────────────────────────────
// No numeric score: a level and the reasons behind it (a number would suggest a precision the method does not have)

export async function analyzeSourceCredibility(sourceInfo, key, provider = 'deepseek') {
  const { url, title, content, author, date } = sourceInfo;

  const prompt = `You are an expert in assessing the credibility of information sources.
Assess the following news item / source:

**URL:** ${url || 'unknown'}
**Title:** ${title || 'unknown'}
**Author:** ${author || 'unknown'}
**Date:** ${date || 'unknown'}
**Content:** ${content?.slice(0, 500) || 'unknown'}

Judge only from what is given above. If something cannot be judged from it, say "unknown". Answer in JSON:
{
  "credibilityLevel": "high|medium|low|doubtful|cannot tell",
  "factors": {
    "sourceReputation": "reputable/not reputable/unknown",
    "authorCredibility": "expert/not stated/no evidence",
    "evidenceQuality": "has evidence/cites itself/no evidence",
    "biasLevel": "neutral/biased/dogmatic",
    "timeliness": "current/outdated/no date"
  },
  "redFlags": ["something doubtful 1", "something doubtful 2"],
  "recommendations": ["use / use with care / do not use"],
  "summary": "a short summary of the credibility"
}`;

  return await callAI(prompt, { key, provider });
}

// ─── 2. Summarise a research document in everyday language ───────────────────

export async function summarizeResearch(researchText, key, provider = 'deepseek') {
  const prompt = `You are a writer who is good at explaining complex things simply.
Summarise the following research document in everyday language, not academic language:

**Document:**
${researchText.slice(0, 5000)}

**Rules:**
- Use everyday language, not academic language
- Explain what was found, why it matters, and what the impact is
- Divide into 4 parts: summary / findings / why it matters / impact on real life
- 300-500 words
- Write in the same language as the document, speaking to the reader as "you"
- Do not add anything that is not in the document

Answer in JSON:
{
  "title": "an easy-to-understand title",
  "summary": "a short summary in 2-3 sentences",
  "keyFindings": ["finding 1", "finding 2", "finding 3"],
  "whyItMatters": "why this matters to ordinary people",
  "practicalImpact": "the effect on everyday life",
  "keywords": ["keyword 1", "keyword 2"],
  "sourceCitation": "a citation of the research source"
}`;

  return await callAI(prompt, { key, provider });
}

// ─── 3. Extract knowledge from a PDF or report ───────────────────────────────

export async function extractFromPDF(pdfText, key, provider = 'deepseek') {
  const prompt = `You are an expert at condensing long documents.
Extract the important knowledge from the following document:

**Document:**
${pdfText.slice(0, 8000)}

**Rules:**
- Keep facts clearly separate from opinions
- Give the citation if there is one (chapter / page / document)
- Summarise as bullet points
- Group by related topic

Answer in JSON:
{
  "title": "the document title",
  "keyPoints": ["key point 1", "key point 2"],
  "facts": [
    { "fact": "a fact", "source": "source", "type": "statistic|fact|opinion" }
  ],
  "statistics": [
    { "stat": "number / statistic", "context": "context", "source": "source" }
  ],
  "methodology": "research method (if any)",
  "limitations": "limitations of the document",
  "summary": "an overall summary in 3-5 sentences",
  "keywords": ["keyword"],
  "citation": "how to cite this document"
}`;

  return await callAI(prompt, { key, provider });
}

// ─── The three functions together ────────────────────────────────────────────

export async function researchTools(tool, data, key, provider = 'deepseek') {
  switch (tool) {
    case 'source-credibility':
      return await analyzeSourceCredibility(data, key, provider);
    case 'summarize-research':
      return await summarizeResearch(data.text || data, key, provider);
    case 'extract-pdf':
      return await extractFromPDF(data.text || data, key, provider);
    default:
      throw new Error(`Unknown research tool: ${tool}. Available: source-credibility, summarize-research, extract-pdf`);
  }
}
