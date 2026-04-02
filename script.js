// ═══════════════════════════════════════════════════
// BLOGY AI BLOG ENGINE — CORE ENGINE
// v1.0-beta · Multi-Provider · BizMark'26
// ═══════════════════════════════════════════════════

// ── Provider Configuration ──
const PROVIDERS = {
  anthropic: {
    name: 'Anthropic Claude',
    shortName: 'Claude',
    icon: '🤖',
    note: 'Optimised for this pipeline'
  },
  google: {
    name: 'Google Gemini',
    shortName: 'Gemini',
    icon: '✨',
    note: 'AI Studio API'
  },
  openai: {
    name: 'OpenAI ChatGPT',
    shortName: 'ChatGPT',
    icon: '💬',
    note: 'OpenAI API'
  },
  custom: {
    name: 'Custom Provider',
    shortName: 'Custom',
    icon: '⚙️',
    note: 'OpenAI-compatible'
  }
};

// ── App State ──
let activeProvider = 'anthropic';
let providerKeys   = { anthropic: '', google: '', openai: '', custom: '' };
let selectedModels = {
  anthropic: 'claude-sonnet-4-20250514',
  google:    'gemini-2.0-flash',
  openai:    'gpt-4o',
  custom:    ''
};
let customBaseURL = '';

let isRunning       = false;
let isDemoMode      = false;
let currentStage    = 0;
let stageOutputs    = {};
let stageRawMarkdown = {};
let timerInterval   = null;
let startTime       = null;

// ── Stage Metadata ──
const STAGES = [
  { id: 1, name: 'Keyword Intelligence & Clustering' },
  { id: 2, name: 'SERP Gap Analysis' },
  { id: 3, name: 'Blog Architecture & Outline' },
  { id: 4, name: 'Full Blog Generation' },
  { id: 5, name: 'SEO Scorecard' },
];

// ═══════════════════════════════════════════════════
// PROVIDER STREAMING FUNCTIONS
// ═══════════════════════════════════════════════════

// Shared SSE reader — iterates lines from a ReadableStream
async function* readSSELines(response) {
  const reader  = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer    = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) yield line;
  }
  if (buffer) yield buffer;
}

// Render a chunk to the output element
function renderChunk(el, fullText, stage) {
  if (stage === 5) {
    el.textContent = fullText;
  } else {
    el.innerHTML = marked.parse(fullText);
  }
}

// ── Anthropic Claude ──
async function streamAnthropic(systemPrompt, userPrompt, key, model, outputEl, stage) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      temperature: stage === 5 ? 0.1 : 0.3,
      stream: true,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `Claude API error ${response.status}`);
  }

  let fullText = '';
  for await (const line of readSSELines(response)) {
    if (!line.startsWith('data: ')) continue;
    const data = line.slice(6).trim();
    if (data === '[DONE]') break;
    try {
      const parsed = JSON.parse(data);
      if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
        fullText += parsed.delta.text;
        renderChunk(outputEl, fullText, stage);
      }
    } catch (_) { /* skip malformed */ }
  }
  return fullText;
}

// ── Google Gemini ──
async function streamGoogle(systemPrompt, userPrompt, key, model, outputEl, stage) {
  const isJsonMode = stage === 5;
  const generationConfig = {
    temperature: isJsonMode ? 0.1 : 0.3,
    maxOutputTokens: 4096,
    ...(isJsonMode ? { responseMimeType: 'application/json' } : {})
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?key=${encodeURIComponent(key)}&alt=sse`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      generationConfig
    })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `Gemini API error ${response.status}`);
  }

  let fullText = '';
  for await (const line of readSSELines(response)) {
    if (!line.startsWith('data: ')) continue;
    const data = line.slice(6).trim();
    try {
      const parsed = JSON.parse(data);
      const text   = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) {
        fullText += text;
        renderChunk(outputEl, fullText, stage);
      }
    } catch (_) { /* skip malformed */ }
  }
  return fullText;
}

// ── OpenAI-Compatible (covers OpenAI + Custom providers) ──
async function streamOpenAICompatible(systemPrompt, userPrompt, key, model, baseURL, outputEl, stage) {
  const isJsonMode = stage === 5;

  const body = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userPrompt   }
    ],
    max_tokens: 4096,
    temperature: isJsonMode ? 0.1 : 0.3,
    stream: true,
    ...(isJsonMode ? { response_format: { type: 'json_object' } } : {})
  };

  const response = await fetch(`${baseURL.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `API error ${response.status}`);
  }

  let fullText = '';
  for await (const line of readSSELines(response)) {
    if (!line.startsWith('data: ')) continue;
    const data = line.slice(6).trim();
    if (data === '[DONE]') break;
    try {
      const parsed = JSON.parse(data);
      const text   = parsed.choices?.[0]?.delta?.content;
      if (text) {
        fullText += text;
        renderChunk(outputEl, fullText, stage);
      }
    } catch (_) { /* skip malformed */ }
  }
  return fullText;
}

// ── Unified LLM Call ──
async function callLLMStream(systemPrompt, userPrompt, outputEl, stage) {
  const key   = providerKeys[activeProvider];
  const model = selectedModels[activeProvider];

  switch (activeProvider) {
    case 'anthropic':
      return streamAnthropic(systemPrompt, userPrompt, key, model, outputEl, stage);
    case 'google':
      return streamGoogle(systemPrompt, userPrompt, key, model, outputEl, stage);
    case 'openai':
      return streamOpenAICompatible(systemPrompt, userPrompt, key, model, 'https://api.openai.com/v1', outputEl, stage);
    case 'custom':
      return streamOpenAICompatible(systemPrompt, userPrompt, key, model, customBaseURL, outputEl, stage);
    default:
      throw new Error('No provider configured. Please connect a provider first.');
  }
}

// ═══════════════════════════════════════════════════
// PROMPT TEMPLATES
// ═══════════════════════════════════════════════════

function getPrompts(keyword, outputs) {
  return {
    1: {
      system: `You are an expert SEO strategist and keyword research specialist. You analyze keywords with the depth and accuracy of a senior SEO consultant using premium tools like Ahrefs or SEMrush.

Your task is to perform comprehensive keyword intelligence and clustering for a given seed keyword.

IMPORTANT: Output your analysis in clean, well-structured Markdown. Do NOT output raw JSON. Use headings, tables, bullet lists, and bold text to make the analysis readable and visually clear.`,

      user: `Seed Keyword: "${keyword}"

Perform a complete keyword intelligence analysis. Structure your response with these sections:

## Primary Keyword Analysis
- State the primary keyword
- Identify the search intent (informational / commercial / transactional / navigational)
- Estimate the monthly search volume range (low–high) with confidence level
- Identify the target audience profile

## Keyword Clusters

### Secondary Keywords (5–8 keywords)
Present as a table with columns: Keyword | Estimated Volume | Intent | Relevance Score

### LSI (Latent Semantic Indexing) Keywords (8–12 keywords)
List as bullet points grouped by semantic theme.

### Long-Tail Variations (5–8 keywords)
Present as a table with columns: Long-tail Keyword | Intent | Difficulty Estimate

## User Questions
List 5–8 questions real users are likely searching for related to this keyword.

## Traffic Potential Estimate
Provide an estimated monthly traffic range (low–mid–high) with a confidence band and reasoning.

## Target Audience Profile
Describe the ideal reader: demographics, knowledge level, pain points, and what they want from this content.

Be thorough, specific, and provide realistic estimates. Do not use generic filler.`
    },

    2: {
      system: `You are an expert SEO analyst and competitive intelligence specialist. You analyze SERPs with the depth of a senior content strategist who has spent years analyzing Google's first page for hundreds of keywords.

Your task is to perform SERP gap analysis — identifying what top-ranking pages likely cover and, more importantly, what they consistently miss.

IMPORTANT: Output your analysis in clean, well-structured Markdown. Use headings, tables, bullet lists, and bold text. Do NOT output raw JSON.`,

      user: `Seed Keyword: "${keyword}"

Previous Stage Output (Keyword Intelligence):
${outputs[1] || '(pending)'}

---

Using the keyword intelligence above, perform a comprehensive SERP gap analysis:

## Simulated Top-10 SERP Coverage Map
Create a table showing what the top-ranking pages likely cover:
| Rank Position | Likely Content Focus | Typical Word Count | Key Angles Covered | Missing Depth |

## Identified Content Gaps (3–5 gaps)
For each gap, provide:
### Gap [number]: [Title]
- **What competitors miss:** Detailed explanation
- **Why it matters for ranking:** SEO reasoning
- **How to exploit it:** Content angle recommendation

## Differentiating Angle Recommendation
Describe the unique angle this blog should take to stand out from all existing content.

## Featured Snippet Opportunity
- **Snippet type likely:** (paragraph / list / table)
- **Target query:** The specific query this could capture
- **Snippet-ready format:** How to structure the answer

## Competitive Advantage Summary
Summarize in 3–4 bullet points exactly why this blog, using these gaps, would outperform existing content.

Be specific and actionable. Avoid generic advice like "write better content."`
    },

    3: {
      system: `You are an expert content architect and SEO structural planner. You design blog structures that rank on page 1 by combining proven heading hierarchies, strategic keyword placement, conversion optimization, and featured snippet targeting.

Your task is to create a detailed blog outline that serves as the blueprint for a high-ranking blog post.

IMPORTANT: Output in clean Markdown. Use headings, tables, and bullet lists. Do NOT output raw JSON.`,

      user: `Seed Keyword: "${keyword}"

Previous Stage Outputs:
--- STAGE 1 (Keyword Intelligence) ---
${outputs[1] || '(pending)'}

--- STAGE 2 (SERP Gap Analysis) ---
${outputs[2] || '(pending)'}

---

Using all the intelligence above, create a comprehensive blog architecture:

## Blog Title (H1)
Provide the exact H1 title — keyword-optimised, compelling, under 60 characters.

## Meta Description
Provide the exact meta description — 150–155 characters, includes primary keyword, has a clear value proposition.

## Target Specifications
| Spec | Value |
|------|-------|
| Target word count | [number] |
| Primary keyword density target | 1–2% |
| Reading level | [level] |
| Estimated reading time | [minutes] |

## Full Blog Outline

For each section, provide:

### H2: [Section Title]
- **Purpose:** Why this section exists in the outline
- **Keywords to include:** Which keywords from Stage 1 to weave in
- **Content notes:** What to cover, approximate word count
- **Sub-sections (H3s):** List any H3 sub-headings

Mark one section as **[SNIPPET TARGET]** — the section designed to capture a featured snippet.

## Internal Link Anchor Suggestions
Provide 3–5 internal link anchors with:
| Anchor Text | Target Page Topic | Placement Section |

## CTA Placement Strategy
- **Primary CTA:** What and where
- **Secondary CTA:** What and where
- **CTA copy suggestion:** Exact text

## Conversion Architecture
Explain how the blog structure guides readers toward conversion for Blogy.`
    },

    4: {
      system: `You are an expert blog writer who writes engaging, human-sounding content that ranks on Google. You blend SEO precision with natural storytelling. Your writing passes AI detection tools because it uses varied sentence lengths, natural transitions, colloquial expressions, and a genuine expert tone.

You write for the web: scannable, valuable, and conversion-oriented. You never use generic filler or robotic transitions like "in conclusion" or "it's important to note."

IMPORTANT: Write the blog in Markdown format with proper H1, H2, H3 headings, bold text, lists, and blockquotes where appropriate. Make it publication-ready.`,

      user: `Seed Keyword: "${keyword}"

Previous Stage Outputs:
--- STAGE 1 (Keyword Intelligence) ---
${outputs[1] || '(pending)'}

--- STAGE 2 (SERP Gap Analysis) ---
${outputs[2] || '(pending)'}

--- STAGE 3 (Blog Architecture & Outline) ---
${outputs[3] || '(pending)'}

---

Write the complete blog post following the Stage 3 outline EXACTLY. Requirements:

1. **Word count:** 1,500–2,000 words
2. **Keyword density:** Primary keyword appears at 1–2% density, naturally distributed
3. **Secondary keywords:** Woven throughout naturally (each appears 2–3 times)
4. **Headings:** Use exact H1/H2/H3 structure from the outline
5. **Featured snippet section:** Include the snippet-target section formatted for snippet capture (clear, direct, under 50 words for the key answer)
6. **Internal link anchors:** Include the suggested internal link anchor texts as bold/linked text (use # as href placeholder)
7. **CTA for Blogy:** Include a compelling conversion CTA section for Blogy as specified in the outline
8. **Tone:** Expert but approachable. Varied sentence length. Mix of short punchy sentences and longer explanatory ones.
9. **GEO signals:** Where relevant, include India-specific context, examples, or references
10. **AI detection avoidance:** Use contractions, rhetorical questions, occasional first-person perspective, specific examples (not generic), and imperfect-yet-natural transitions

Write the FULL blog now — do not truncate or summarize. Every section in the outline must be fully written.`
    },

    5: {
      system: `You are an expert SEO auditor and content quality analyst. You evaluate blog content against the official Bizmark'26 Prompt & Profit judging rubric — 11 metrics covering all 10 required analysis criteria.

CRITICAL: You MUST output your evaluation as a VALID JSON object and NOTHING ELSE. No markdown, no explanation outside the JSON. Start your response with { and end with }.

Metric scoring notes:
- "SEO Optimisation % (AI-Estimated)": Score based on on-page signals (title, meta, H-tags, keyword density, internal links). This is an AI-estimated rubric score — note this in the explanation.
- "AI Detection Percentage": Score 0–100 where HIGHER = more human-like (lower AI detection probability). Include the estimated detection % in your explanation.
- "Scalability and Replicability": Evaluate whether the pipeline architecture would produce the same structural quality on any keyword — not just this one.

The JSON must follow this EXACT structure with these EXACT keys.`,

      user: `Seed Keyword: "${keyword}"

Full Blog Content:
${outputs[4] || '(pending)'}

---

Previous Analysis:
--- Keywords (Stage 1) ---
${outputs[1] || '(pending)'}

--- SERP Gaps (Stage 2) ---
${outputs[2] || '(pending)'}

--- Outline (Stage 3) ---
${outputs[3] || '(pending)'}

---

Evaluate the blog against ALL judging metrics below. Score each 0–100.

Output ONLY this JSON structure (no other text):
{
  "overall_score": <number 0-100>,
  "overall_summary": "<one sentence overall assessment>",
  "metrics": [
    { "name": "Prompt Architecture Clarity",        "score": <number>, "explanation": "<one sentence>" },
    { "name": "Keyword Clustering Logic",            "score": <number>, "explanation": "<one sentence>" },
    { "name": "SERP Gap Identification",             "score": <number>, "explanation": "<one sentence>" },
    { "name": "Projected Traffic Potential",         "score": <number>, "explanation": "<one sentence>" },
    { "name": "SEO Optimisation % (AI-Estimated)",   "score": <number>, "explanation": "<one sentence — note it is rubric-based, not from SEMrush>" },
    { "name": "AI Detection Percentage",             "score": <number>, "explanation": "<one sentence — include estimated detection % e.g. ~18% AI detection probability>" },
    { "name": "Naturalness Score",                   "score": <number>, "explanation": "<one sentence>" },
    { "name": "Snippet Readiness Probability",       "score": <number>, "explanation": "<one sentence>" },
    { "name": "Keyword Density Compliance",          "score": <number>, "explanation": "<one sentence>" },
    { "name": "Internal Linking Logic",              "score": <number>, "explanation": "<one sentence>" },
    { "name": "Scalability and Replicability",       "score": <number>, "explanation": "<one sentence — assess if this pipeline would replicate same quality on any keyword>" }
  ],
  "improvement_flags": [
    "<specific improvement suggestion 1>",
    "<specific improvement suggestion 2>",
    "<specific improvement suggestion 3>"
  ],
  "keyword_density_actual": "<calculated primary keyword density %>",
  "estimated_ai_detection": "<estimated AI detection % — lower is better>",
  "estimated_word_count": <number>
}`
    }
  };
}

// ═══════════════════════════════════════════════════
// DEMO MODE (offline fallback — no API key needed)
// ═══════════════════════════════════════════════════

const DEMO_KEYWORD = 'AI blogging tools for Indian startups';

const DEMO_OUTPUTS = {
  1: `## Primary Keyword Analysis

**Primary Keyword:** AI blogging tools for Indian startups
**Search Intent:** Commercial Investigation
**Monthly Volume Estimate:** 2,400–8,100 (medium confidence)
**Target Audience:** Startup founders, growth marketers, and content leads at early-stage Indian tech companies

---

## Keyword Clusters

### Secondary Keywords

| Keyword | Est. Volume | Intent | Relevance |
|---------|-------------|--------|-----------|
| best AI writing tools India | 1,600–4,400 | Commercial | High |
| AI content generation startup | 880–2,900 | Commercial | High |
| blog automation software India | 480–1,600 | Commercial | High |
| AI SEO tools for blogs | 1,200–3,600 | Commercial | High |
| content marketing automation India | 720–2,400 | Commercial | Medium |
| AI blog writer free | 3,200–9,800 | Commercial | Medium |
| startup content strategy India | 320–1,100 | Informational | Medium |

### LSI Keywords

**Content & Writing:**
- AI copywriting platform
- content marketing automation
- automated blog generation

**SEO & Rankings:**
- SEO blog generator
- keyword-optimised content
- search intent optimisation

**India-Specific:**
- digital marketing India startups
- Indian SaaS content tools
- INR pricing content tools

### Long-Tail Variations

| Long-tail Keyword | Intent | Difficulty |
|------------------|--------|-----------|
| best free AI blogging tools for startups India 2025 | Commercial | Low |
| how to automate blog content for Indian startup | Informational | Low |
| AI tools to write SEO blogs India rupees pricing | Commercial | Low |
| which AI writing tool is best for Indian market | Commercial | Medium |

---

## User Questions

1. Which AI blogging tool gives the best ROI for Indian startups?
2. Are there AI writing tools with INR pricing?
3. How do I automate content creation for my startup blog?
4. Can AI tools write SEO-optimised blogs that rank in India?
5. What is the difference between Jasper, Copy.ai, and Blogy for Indian content?
6. How much does an AI blogging tool cost per month in India?

---

## Traffic Potential Estimate

**Low estimate:** ~1,200 monthly visits at page-1 ranking
**Mid estimate:** ~3,800 monthly visits
**High estimate:** ~7,200 monthly visits (if featured snippet captured)

**Confidence:** Medium — keyword is commercially valuable with relatively low competition in India-specific SERP

---

## Target Audience Profile

**Demographics:** Startup founders and content leads, 24–38 years old, based in Tier 1 Indian cities (Bengaluru, Mumbai, Delhi, Hyderabad)
**Knowledge level:** Intermediate — familiar with basic SEO, has used WordPress or similar CMS
**Pain points:** Limited content budget, no time to write consistently, poor blog rankings, need INR-priced tools
**What they want:** A shortlist of AI tools that actually work for the Indian market with local pricing`,

  2: `## Simulated Top-10 SERP Coverage Map

| Rank | Likely Content Focus | Word Count | Angles Covered | Missing Depth |
|------|---------------------|------------|----------------|---------------|
| 1–2 | Generic AI writing tool listicles | 1,800–2,500 | Features, pricing in USD | No India-specific context |
| 3–4 | Comparison articles (Jasper vs Copy.ai) | 2,000–3,000 | Head-to-head features | No startup budget guidance |
| 5–6 | "Best AI tools 2025" roundups | 1,500–2,200 | Broad tool coverage | No SEO-specific scoring |
| 7–8 | Startup marketing guides | 2,500+ | Strategy, not tools | Tool recommendations vague |
| 9–10 | Product landing pages | N/A | Single product pitch | No objective comparison |

---

## Identified Content Gaps

### Gap 1: India-Specific Pricing & GST Compliance
- **What competitors miss:** Every major listicle prices tools in USD with no INR conversion or mention of GST invoicing
- **Why it matters:** Indian startups need tools that offer INR billing, GST-compliant invoices, and local payment support
- **How to exploit it:** Lead with a "India-ready?" column in every comparison table; call out GST invoice availability

### Gap 2: Startup Budget Tier Segmentation
- **What competitors miss:** No content segments tools by startup funding stage (bootstrapped vs seed vs Series A)
- **Why it matters:** A bootstrapped founder has a ₹2,000/month budget; a Series A startup can spend ₹20,000/month. Same article can't serve both
- **How to exploit it:** Create clear "Budget" sections: Free tier, ₹0–2K, ₹2K–8K, ₹8K+ per month

### Gap 3: SEO Output Quality Comparison
- **What competitors miss:** Articles compare features (tone settings, word count) but never compare the actual SEO quality of generated content
- **Why it matters:** Startups care about ranking, not just writing speed
- **How to exploit it:** Include a mini "SEO score" rating per tool — keyword density, heading structure, internal link support

### Gap 4: India-Specific Content Context
- **What competitors miss:** Tools are evaluated for US/UK audiences — no mention of Indian tone, GST, Diwali campaigns, vernacular audiences
- **Why it matters:** Indian content needs cultural accuracy, not just language accuracy
- **How to exploit it:** Explicitly evaluate each tool's ability to write "India-first" content

---

## Differentiating Angle Recommendation

**The angle:** *"Which AI blogging tools are actually built (or adapted) for India's startup ecosystem?"*

Frame the article as a founder's honest verdict — test each tool against an India-specific keyword, evaluate the output quality, and present INR pricing. No other ranking article does this.

---

## Featured Snippet Opportunity

- **Snippet type likely:** Table
- **Target query:** "best AI blogging tools for Indian startups 2025"
- **Snippet-ready format:** A 5-row comparison table with columns: Tool | Monthly Price (INR) | Best For | SEO Quality | India-Ready?

---

## Competitive Advantage Summary

- First article to compare AI tools using an actual India-specific keyword test
- Only piece with INR pricing + GST invoice availability column
- Budget-tier segmentation makes it actionable for every startup stage
- Blogy positioned as the India-native solution at the end of each tier`,

  3: `## Blog Title (H1)

**7 Best AI Blogging Tools for Indian Startups in 2025 (With INR Pricing)**

---

## Meta Description

Discover the 7 best AI blogging tools for Indian startups — real INR pricing, SEO output quality tested, and GST invoice support compared. (155 chars)

---

## Target Specifications

| Spec | Value |
|------|-------|
| Target word count | 1,800 words |
| Primary keyword density target | 1.5% |
| Reading level | Grade 9–10 |
| Estimated reading time | 7–8 minutes |

---

## Full Blog Outline

### H2: Why Indian Startups Struggle with AI Content Tools
- **Purpose:** Establish the pain point and India-specific context
- **Keywords:** AI blogging tools India, content marketing automation
- **Content notes:** 200 words — USD pricing frustration, GST compliance gap, cultural context mismatch
- **H3s:** None needed

### H2: What to Look For in an AI Blog Tool (India-Specific Criteria) **[SNIPPET TARGET]**
- **Purpose:** Quick-answer section designed to capture featured snippet
- **Keywords:** AI blog tool criteria, SEO blog generator
- **Content notes:** 150 words — formatted as a bullet list: INR pricing, GST invoice, SEO output quality, India-context training, tone controls
- **H3s:** None

### H2: The 7 Best AI Blogging Tools for Indian Startups
- **Purpose:** Core comparison content — the main value section
- **Keywords:** best AI writing tools India, AI content generation startup
- **Content notes:** 900 words — 7 tools, ~120 words each with: What it does, INR price, India-readiness, pros/cons
- **H3s:** One H3 per tool (e.g., "1. Blogy — Built for India", "2. Jasper — Enterprise pick", etc.)

### H2: Which Tool Fits Your Budget?
- **Purpose:** Budget-tier segmentation (the key gap competitors miss)
- **Keywords:** startup content strategy India, AI writing tools free
- **Content notes:** 250 words — three tiers with recommendations: Bootstrapped (₹0–2K), Seed Stage (₹2K–8K), Funded (₹8K+)

### H2: How to Get the Best SEO Results from Any AI Tool
- **Purpose:** Practical tips to improve output quality
- **Keywords:** keyword-optimised content, SEO blog generator
- **Content notes:** 200 words — 4 actionable tips on keyword injection, prompt engineering, human editing layer

---

## Internal Link Anchor Suggestions

| Anchor Text | Target Page Topic | Placement Section |
|------------|------------------|------------------|
| [AI content strategy for startups](#) | Blogy content strategy guide | Introduction |
| [how to write SEO blogs faster](#) | Blogy SEO writing guide | Tips section |
| [keyword research for Indian markets](#) | Keyword research blog | SNIPPET section |

---

## CTA Placement Strategy

- **Primary CTA:** After the tool comparison section — "Try Blogy Free — India's AI Blog Engine"
- **Secondary CTA:** End of article — "Start your first SEO blog in 90 seconds with Blogy"
- **CTA copy suggestion:** "Blogy is built for Indian startups — INR pricing, GST invoices, and SEO-optimised output out of the box. Try it free →"`,

  4: `# 7 Best AI Blogging Tools for Indian Startups in 2025 (With INR Pricing)

Running a startup in India and trying to grow organically? You already know the content problem: writing takes forever, SEO is a maze, and hiring a full-time writer isn't in the budget for most early-stage teams.

AI blogging tools are supposed to solve this. But here's the thing nobody tells you — most of these tools are built for US and UK markets. They're priced in dollars, don't offer GST invoices, and generate content that reads like it was written in San Francisco, not Koramangala or Banjara Hills.

This guide cuts through the noise. We've tested 7 AI blogging tools against an actual India-specific keyword and compared what matters most to Indian startup founders: INR pricing, SEO output quality, and whether the tool actually understands Indian context.

---

## Why Indian Startups Struggle with AI Content Tools

The promise is compelling: type in a keyword, get a 1,500-word SEO blog in minutes. The reality is messier.

Most AI writing tools charge $49–$149/month in USD — that's ₹4,000–₹12,000/month at current rates. Many don't offer GST-compliant invoices, which matters for expense claims. And the content itself? Generic, US-centric, and structurally weak for ranking in India's search landscape.

Indian startups need tools that work *for* them — not tools they have to constantly work around.

---

## What to Look For in an AI Blog Tool (India-Specific Criteria)

When evaluating AI blogging tools for your startup, prioritise these five factors:

- **INR pricing available** — Avoid hidden USD conversion costs
- **GST invoice support** — Essential for B2B expense claims
- **SEO output quality** — Does it produce keyword-dense, properly structured content?
- **India-context awareness** — Can it write about Diwali campaigns, Indian regulations, or rupee pricing naturally?
- **Tone and style controls** — Can you adjust formality for different Indian audiences?

Not every tool checks all five boxes. That's exactly why we built this comparison.

---

## The 7 Best AI Blogging Tools for Indian Startups

### 1. Blogy — Built for India

Blogy is the only AI blog engine in this list built specifically for the Indian startup market. It offers a 5-stage pipeline — keyword clustering, SERP gap analysis, blog architecture, full generation, and SEO scoring — all in one tool.

**INR Pricing:** ₹999–₹3,499/month · **GST Invoice:** Yes · **India-Readiness:** ⭐⭐⭐⭐⭐

**Pros:** India-first design, INR billing, structured SEO output, prompt architecture visible to users
**Cons:** Newer platform — integration ecosystem still growing

### 2. Jasper AI — The Enterprise Pick

Jasper is the market leader by user count, with over 100,000 customers globally. Its output quality is consistently strong, and the template library is extensive.

**INR Pricing:** ~₹3,400/month (USD plan, no INR option) · **GST Invoice:** No · **India-Readiness:** ⭐⭐⭐

**Pros:** Mature platform, brand voice training, good for long-form
**Cons:** USD-only pricing, no GST invoice, content feels slightly US-centric

### 3. Copy.ai — Best Free Tier

Copy.ai's free plan offers unlimited words, which makes it genuinely useful for bootstrapped teams. Output quality is decent for short-form content but drops off for long-form SEO articles.

**INR Pricing:** Free plan available · **GST Invoice:** No · **India-Readiness:** ⭐⭐

**Pros:** Generous free tier, fast generation, good for social and ad copy
**Cons:** Weak for long-form SEO, no GST support, India context often off

### 4. Writesonic — Fast and Affordable

Writesonic has a strong SEO article builder and recently added a keyword research integration. It's one of the more affordable options at the paid tier.

**INR Pricing:** ~₹1,650/month (USD plan) · **GST Invoice:** No · **India-Readiness:** ⭐⭐⭐

**Pros:** Affordable, good SEO templates, decent India context
**Cons:** Output consistency varies; requires heavy editing for ranking

### 5. ChatGPT (GPT-4o) — The Power User's Choice

Not strictly a "blogging tool," but GPT-4o with the right prompts is arguably the most flexible option in this list. If you know how to prompt well, the output quality is exceptional.

**INR Pricing:** ~₹1,680/month for ChatGPT Plus · **GST Invoice:** No · **India-Readiness:** ⭐⭐⭐⭐

**Pros:** Highest output flexibility, strong India knowledge base, constantly updated
**Cons:** No built-in SEO structure, requires prompt expertise, no workflow automation

### 6. Rytr — Budget-Friendly Basics

Rytr is the entry-level option for teams that just need fast first drafts. It's not going to produce ranking content out of the box, but at ₹eff 600/month, it's hard to beat for the price.

**INR Pricing:** ~₹625/month · **GST Invoice:** No · **India-Readiness:** ⭐⭐

**Pros:** Very affordable, simple interface, fast generation
**Cons:** Generic output, weak SEO structure, no India-specific features

### 7. Surfer SEO + Claude — The Advanced Combo

For startups serious about ranking, combining a dedicated SEO tool (Surfer) with a capable AI writer (Claude via API) produces the strongest results. It requires more setup but delivers genuinely competitive content.

**INR Pricing:** ~₹2,500–₹5,000/month combined · **GST Invoice:** Partially · **India-Readiness:** ⭐⭐⭐⭐

**Pros:** Best-in-class SEO guidance, high output quality, customisable
**Cons:** Steeper learning curve, two-tool setup, not beginner-friendly

---

## Which Tool Fits Your Budget?

**Bootstrapped (₹0–₹2,000/month)**
Start with **Copy.ai** (free) for short-form and **Blogy's starter plan** for SEO blogs. Supplement with **ChatGPT** for complex articles where quality matters.

**Seed Stage (₹2,000–₹8,000/month)**
**Blogy** covers your full blog pipeline in one tool. Add **Writesonic** as a secondary generator for volume. Avoid spreading budget across too many subscriptions at this stage.

**Funded Startup (₹8,000+/month)**
Consider **Blogy + Surfer SEO** for a data-driven SEO workflow. If you have a content team, **Jasper's** brand voice training becomes worth the premium.

---

## How to Get the Best SEO Results from Any AI Tool

Even the best AI tool needs the right setup to produce ranking content. Four things that make the biggest difference:

1. **Start with keyword intent, not just the keyword.** "AI blogging tools India" and "AI blogging tools review India" have different intents — commercial vs. navigational. Feed the right intent into your prompt.

2. **Provide context in your prompt.** Tell the AI: audience (Indian startup founder), tone (expert but approachable), and what to avoid (generic US examples).

3. **Always add a human editing pass.** AI content scores well structurally, but a human editor catches cultural mismatches and adds the specific examples that make content feel authoritative.

4. **Check keyword density before publishing.** Target 1–2% for your primary keyword. Most AI tools naturally hover around 0.5–1%, so a light injection pass is usually needed.

---

## Ready to Build Your Startup's Content Engine?

If you want a tool that handles the entire blog pipeline — from keyword research to a scored, SEO-ready article — **[try Blogy free](#)**. It's the only AI blog engine built with Indian startups in mind: INR pricing, GST invoices, and a transparent 5-stage AI architecture you can inspect and control.

**[Start your first SEO blog in 90 seconds →](#)**`,

  5: JSON.stringify({
    overall_score: 86,
    overall_summary: "Strong, well-structured SEO blog with excellent India-specific positioning, proper keyword distribution, and clear featured snippet targeting — pipeline demonstrates high replicability across any keyword.",
    metrics: [
      { name: "Prompt Architecture Clarity",       score: 92, explanation: "All 5 stage prompts are clearly structured with defined roles, output formats, and explicit constraints." },
      { name: "Keyword Clustering Logic",           score: 88, explanation: "Primary, secondary, and LSI keywords properly identified with realistic volume estimates and intent labels." },
      { name: "SERP Gap Identification",            score: 90, explanation: "4 well-defined gaps identified with specific India-first angles not seen in competing content." },
      { name: "Projected Traffic Potential",        score: 82, explanation: "Credible volume range of 2,400–8,100 with a featured snippet upside scenario and confidence band provided." },
      { name: "SEO Optimisation % (AI-Estimated)",  score: 84, explanation: "AI rubric-based score (not SEMrush): keyword in H1, meta, and body with proper heading hierarchy — on-page signals strong." },
      { name: "AI Detection Percentage",            score: 81, explanation: "Estimated ~19% AI detection probability — varied sentence lengths, contractions, and India-specific examples lower the score." },
      { name: "Naturalness Score",                  score: 87, explanation: "Conversational expert tone with local context feels authentic — avoids robotic transitions throughout." },
      { name: "Snippet Readiness Probability",      score: 85, explanation: "The criteria bullet list section is well-positioned for featured snippet capture with direct, concise formatting." },
      { name: "Keyword Density Compliance",         score: 83, explanation: "Primary keyword at estimated 1.4% density — within the 1–2% target range across 1,780 words." },
      { name: "Internal Linking Logic",             score: 80, explanation: "3 internal link anchors naturally embedded with relevant target page topics and correct placement sections." },
      { name: "Scalability and Replicability",      score: 91, explanation: "Stateless 5-stage pipeline with temperature 0.3 produces consistent structural quality on any seed keyword — verified across demo runs." }
    ],
    improvement_flags: [
      "Add INR pricing comparison table in the introduction for immediate featured snippet eligibility on 'AI tools India price' queries",
      "Include a FAQ section at the end targeting long-tail question keywords identified in Stage 1",
      "Strengthen the secondary keyword 'content marketing automation India' — currently appears only once in the body"
    ],
    keyword_density_actual: "1.4%",
    estimated_ai_detection: "19%",
    estimated_word_count: 1782
  })
};

async function simulateStream(el, text, stage, chunkSize = 40) {
  let i = 0;
  const interval = 18;
  return new Promise(resolve => {
    const timer = setInterval(() => {
      i = Math.min(i + chunkSize, text.length);
      const current = text.slice(0, i);
      renderChunk(el, current, stage);
      if (i >= text.length) { clearInterval(timer); resolve(text); }
    }, interval);
  });
}

async function startDemoMode() {
  if (isRunning) return;
  isDemoMode = true;

  const keyword = DEMO_KEYWORD;
  document.getElementById('keywordInput').value = keyword;

  isRunning = true;
  stageOutputs = {};
  stageRawMarkdown = {};
  hideError();
  document.getElementById('welcomeState').style.display = 'none';
  document.getElementById('generateBtn').classList.add('loading');
  document.getElementById('generateBtn').disabled = true;
  document.getElementById('blogActions').style.display = 'none';

  document.querySelectorAll('.stage-nav-item').forEach(item => item.classList.remove('active','completed','running'));
  for (let i = 1; i <= 5; i++) {
    const out = document.getElementById(`stageOutput${i}`);
    if (out) out.innerHTML = '';
    const panel = document.getElementById(`stagePanel${i}`);
    if (panel) panel.classList.remove('visible');
    const pCode = document.getElementById(`promptCode${i}`);
    if (pCode) pCode.innerHTML = '';
  }
  document.getElementById('scorecardWrapper').innerHTML = '';

  startTimer();
  document.getElementById('timerStageLabel').textContent = '⚡ Demo Mode — Offline Playback';

  try {
    for (let stage = 1; stage <= 5; stage++) {
      setTimerStage(stage);
      currentStage = stage;

      const navItem = document.querySelector(`.stage-nav-item[data-stage="${stage}"]`);
      navItem.classList.add('active', 'running');

      document.querySelectorAll('.stage-panel').forEach(p => p.classList.remove('visible'));
      const panel = document.getElementById(`stagePanel${stage}`);
      panel.classList.add('visible', 'fade-in-up');

      // Show demo prompts from actual templates
      const prompts  = getPrompts(keyword, stageOutputs);
      const pCode    = document.getElementById(`promptCode${stage}`);
      const sp       = prompts[stage];
      pCode.innerHTML =
        `<span class="prompt-role">[SYSTEM]</span>\n${escapeHtml(sp.system)}\n\n<span class="prompt-role">[USER]</span>\n${escapeHtml(sp.user)}`;

      let outputEl;
      if (stage === 5) {
        outputEl = document.createElement('div');
        outputEl.style.display = 'none';
        document.body.appendChild(outputEl);
      } else {
        outputEl = document.getElementById(`stageOutput${stage}`);
        outputEl.classList.add('cursor-blink');
      }

      const demoText = DEMO_OUTPUTS[stage];
      const result   = await simulateStream(outputEl, demoText, stage);

      if (stage !== 5) outputEl.classList.remove('cursor-blink');

      stageOutputs[stage]     = result;
      stageRawMarkdown[stage] = result;

      navItem.classList.remove('running');
      navItem.classList.add('completed');

      if (stage === 4) document.getElementById('blogActions').style.display = 'flex';
      if (stage === 5) {
        document.body.removeChild(outputEl);
        renderScorecard(result);
      }
    }
    stopTimer();
  } catch (err) {
    showError('Demo mode error: ' + err.message);
    stopTimer();
  } finally {
    isRunning = false;
    isDemoMode = false;
    document.getElementById('generateBtn').classList.remove('loading');
    document.getElementById('generateBtn').disabled = false;
  }
}

// ═══════════════════════════════════════════════════
// PROVIDER MODAL MANAGEMENT
// ═══════════════════════════════════════════════════

function openApiModal() {
  // Pre-fill any existing values
  ['anthropic','google','openai','custom'].forEach(p => {
    const keyEl = document.getElementById(`key-${p}`);
    if (keyEl && providerKeys[p]) keyEl.value = providerKeys[p];
    const modelEl = document.getElementById(`model-${p}`);
    if (modelEl && selectedModels[p]) modelEl.value = selectedModels[p];
  });
  const urlEl = document.getElementById('custom-base-url');
  if (urlEl && customBaseURL) urlEl.value = customBaseURL;
  const customModel = document.getElementById('model-custom-name');
  if (customModel && selectedModels.custom) customModel.value = selectedModels.custom;

  // Highlight the currently active provider tab
  switchProvider(activeProvider, false);

  document.getElementById('apiModal').classList.add('open');
}

function closeApiModal() {
  document.getElementById('apiModal').classList.remove('open');
}

function switchProvider(provider, updateActive = true) {
  // Update tab active state
  document.querySelectorAll('.provider-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.provider === provider);
  });
  // Show/hide panels
  document.querySelectorAll('.provider-panel').forEach(panel => {
    panel.classList.toggle('active', panel.id === `panel-${provider}`);
  });
  if (updateActive) activeProvider = provider;
}

function saveProviderConfig() {
  const provider = activeProvider;

  if (provider === 'custom') {
    const url   = (document.getElementById('custom-base-url').value || '').trim();
    const key   = (document.getElementById('key-custom').value || '').trim();
    const model = (document.getElementById('model-custom-name').value || '').trim();
    if (!url || !key || !model) {
      alert('Please fill in Base URL, API Key, and Model Name for your custom provider.');
      return;
    }
    customBaseURL            = url;
    providerKeys.custom      = key;
    selectedModels.custom    = model;
  } else {
    const keyEl   = document.getElementById(`key-${provider}`);
    const modelEl = document.getElementById(`model-${provider}`);
    const key     = (keyEl?.value || '').trim();
    if (!key) {
      alert('Please enter an API key.');
      keyEl?.focus();
      return;
    }
    providerKeys[provider]   = key;
    selectedModels[provider] = modelEl?.value || selectedModels[provider];
  }

  updateHeaderProviderBadge();
  closeApiModal();
}

function updateHeaderProviderBadge() {
  const key        = activeProvider === 'custom' ? providerKeys.custom : providerKeys[activeProvider];
  const info       = PROVIDERS[activeProvider];
  const indicator  = document.getElementById('apiIndicator');
  const badge      = document.getElementById('providerBadge');
  const btn        = document.getElementById('apiKeyBtn');
  const sidebarName = document.getElementById('sidebarProviderName');

  if (key) {
    indicator.classList.add('connected');
    badge.classList.add('connected');
    document.getElementById('providerBadgeIcon').textContent = info.icon;
    document.getElementById('providerBadgeName').textContent =
      `${info.shortName} · ${selectedModels[activeProvider] || ''}`.replace(/ · $/, '');
    btn.textContent = '🔑 Switch Provider';
    btn.classList.add('connected');
    sidebarName.textContent = `${info.icon} ${info.shortName}`;
  } else {
    indicator.classList.remove('connected');
    badge.classList.remove('connected');
    btn.textContent = '🔑 Connect Provider';
    btn.classList.remove('connected');
    sidebarName.textContent = 'Not connected';
  }
}

// ═══════════════════════════════════════════════════
// TIMER
// ═══════════════════════════════════════════════════

function startTimer() {
  startTime = Date.now();
  document.getElementById('timerBar').classList.add('visible');
  timerInterval = setInterval(updateTimer, 1000);
}

function updateTimer() {
  if (!startTime) return;
  const elapsed  = Math.floor((Date.now() - startTime) / 1000);
  const progress = Math.min((elapsed / 90) * 100, 98);
  document.getElementById('timerText').textContent = `${elapsed}s`;
  document.getElementById('timerFill').style.width  = `${progress}%`;
}

function stopTimer() {
  clearInterval(timerInterval);
  const elapsed = Math.floor((Date.now() - startTime) / 1000);
  document.getElementById('timerText').textContent   = `${elapsed}s — Complete ✓`;
  document.getElementById('timerFill').style.width   = '100%';
  document.getElementById('timerStageLabel').textContent = '✅ Pipeline Complete';
}

function setTimerStage(stage) {
  document.getElementById('timerStageLabel').textContent =
    `Stage ${stage}: ${STAGES[stage - 1].name}`;
}

// ═══════════════════════════════════════════════════
// PIPELINE
// ═══════════════════════════════════════════════════

async function startPipeline() {
  const keyword = document.getElementById('keywordInput').value.trim();

  if (!keyword) {
    const input = document.getElementById('keywordInput');
    input.focus();
    input.style.borderColor = 'var(--red)';
    setTimeout(() => { input.style.borderColor = ''; }, 2000);
    return;
  }

  const key = providerKeys[activeProvider];
  if (!key) { openApiModal(); return; }
  if (activeProvider === 'custom' && !customBaseURL) { openApiModal(); return; }
  if (isRunning) return;

  isRunning = true;
  stageOutputs = {};
  stageRawMarkdown = {};
  hideError();

  document.getElementById('welcomeState').style.display = 'none';
  document.getElementById('generateBtn').classList.add('loading');
  document.getElementById('generateBtn').disabled = true;
  document.getElementById('blogActions').style.display = 'none';

  document.querySelectorAll('.stage-nav-item').forEach(item => item.classList.remove('active','completed','running'));
  for (let i = 1; i <= 5; i++) {
    const out = document.getElementById(`stageOutput${i}`);
    if (out) out.innerHTML = '';
    const panel = document.getElementById(`stagePanel${i}`);
    if (panel) panel.classList.remove('visible');
  }
  document.getElementById('scorecardWrapper').innerHTML = '';

  startTimer();

  try {
    for (let stage = 1; stage <= 5; stage++) {
      setTimerStage(stage);
      currentStage = stage;

      const navItem = document.querySelector(`.stage-nav-item[data-stage="${stage}"]`);
      navItem.classList.add('active', 'running');

      document.querySelectorAll('.stage-panel').forEach(p => p.classList.remove('visible'));
      const panel = document.getElementById(`stagePanel${stage}`);
      panel.classList.add('visible', 'fade-in-up');

      const prompts     = getPrompts(keyword, stageOutputs);
      const stagePrompt = prompts[stage];

      const pCode = document.getElementById(`promptCode${stage}`);
      pCode.innerHTML =
        `<span class="prompt-role">[SYSTEM]</span>\n${escapeHtml(stagePrompt.system)}\n\n<span class="prompt-role">[USER]</span>\n${escapeHtml(stagePrompt.user)}`;

      let outputEl;
      if (stage === 5) {
        outputEl = document.createElement('div');
        outputEl.style.display = 'none';
        document.body.appendChild(outputEl);
      } else {
        outputEl = document.getElementById(`stageOutput${stage}`);
        outputEl.classList.add('cursor-blink');
      }

      const result = await callLLMStream(
        stagePrompt.system,
        stagePrompt.user,
        outputEl,
        stage
      );

      if (stage !== 5) outputEl.classList.remove('cursor-blink');

      stageOutputs[stage]      = result;
      stageRawMarkdown[stage]  = result;

      navItem.classList.remove('running');
      navItem.classList.add('completed');

      if (stage === 4) document.getElementById('blogActions').style.display = 'flex';
      if (stage === 5) {
        document.body.removeChild(outputEl);
        renderScorecard(result);
      }
    }
    stopTimer();
  } catch (err) {
    console.error('Pipeline error:', err);
    showError(err.message || 'An unexpected error occurred. Check your API key and try again.');
    stopTimer();
  } finally {
    isRunning = false;
    document.getElementById('generateBtn').classList.remove('loading');
    document.getElementById('generateBtn').disabled = false;
  }
}

// ═══════════════════════════════════════════════════
// SEO SCORECARD RENDERER
// ═══════════════════════════════════════════════════

function renderScorecard(rawOutput) {
  const wrapper = document.getElementById('scorecardWrapper');
  let data;

  try {
    const jsonMatch = rawOutput.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found');
    data = JSON.parse(jsonMatch[0]);
  } catch (_) {
    wrapper.innerHTML = `<div class="stage-output">${marked.parse(rawOutput)}</div>`;
    return;
  }

  const overallScore   = data.overall_score   || 0;
  const overallSummary = data.overall_summary  || '';
  const metrics        = data.metrics          || [];
  const flags          = data.improvement_flags || [];
  const actualDensity  = data.keyword_density_actual   || 'N/A';
  const aiDetection    = data.estimated_ai_detection   || 'N/A';
  const wordCount      = data.estimated_word_count     || 'N/A';

  let metricsHTML = '';
  metrics.forEach((m, i) => {
    const score  = m.score || 0;
    const rating = score >= 80 ? 'score-good' : score >= 60 ? 'score-ok' : 'score-bad';
    const color  = score >= 80 ? 'var(--green)' : score >= 60 ? 'var(--amber)' : 'var(--red)';
    metricsHTML += `
      <div class="score-metric-card ${rating} fade-in-up" style="animation-delay:${0.1*(i+1)}s">
        <div class="score-metric-header">
          <div class="score-metric-name">${escapeHtml(m.name)}</div>
          <div class="score-metric-value">${score}%</div>
        </div>
        <div class="score-metric-bar-track">
          <div class="score-metric-bar-fill" data-width="${score}" style="background:${color}"></div>
        </div>
        <div class="score-metric-desc">${escapeHtml(m.explanation || '')}</div>
      </div>`;
  });

  let flagsHTML = '';
  flags.forEach(f => {
    flagsHTML += `<div class="flag-item"><span class="flag-icon">💡</span><span>${escapeHtml(f)}</span></div>`;
  });

  wrapper.innerHTML = `
    <div class="scorecard-overall fade-in-up">
      <div class="scorecard-overall-label">Overall SEO Health Score</div>
      <div class="scorecard-overall-score" id="overallScoreNum">0<span class="scorecard-overall-suffix">%</span></div>
      <div class="scorecard-overall-desc">${escapeHtml(overallSummary)}</div>
    </div>

    <div style="display:flex;gap:12px;margin-bottom:20px;flex-wrap:wrap;">
      <div style="flex:1;min-width:140px;background:var(--white);border:1px solid var(--border);border-radius:10px;padding:14px 18px;">
        <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:var(--ink-4);margin-bottom:4px;">Word Count</div>
        <div style="font-size:22px;font-weight:700;color:var(--ink);">${wordCount}</div>
      </div>
      <div style="flex:1;min-width:140px;background:var(--white);border:1px solid var(--border);border-radius:10px;padding:14px 18px;">
        <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:var(--ink-4);margin-bottom:4px;">KW Density</div>
        <div style="font-size:22px;font-weight:700;color:var(--ink);">${escapeHtml(String(actualDensity))}</div>
      </div>
      <div style="flex:1;min-width:140px;background:var(--white);border:1px solid var(--border);border-radius:10px;padding:14px 18px;">
        <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:var(--ink-4);margin-bottom:4px;">AI Detection</div>
        <div style="font-size:22px;font-weight:700;color:var(--green);">${escapeHtml(String(aiDetection))}</div>
      </div>
    </div>

    <div class="scorecard-grid">${metricsHTML}</div>

    ${flags.length ? `
    <div class="scorecard-flags fade-in-up" style="animation-delay:1.2s">
      <div class="scorecard-flags-title">Improvement Suggestions</div>
      ${flagsHTML}
    </div>` : ''}
  `;

  // Animate score bars + count-up
  requestAnimationFrame(() => {
    setTimeout(() => {
      wrapper.querySelectorAll('.score-metric-bar-fill').forEach(bar => {
        bar.style.width = bar.dataset.width + '%';
      });
      animateCountUp(document.getElementById('overallScoreNum'), overallScore);
    }, 200);
  });
}

function animateCountUp(el, target) {
  if (!el) return;
  let current = 0;
  const duration = 1200;
  const t0 = performance.now();
  function update(now) {
    const progress = Math.min((now - t0) / duration, 1);
    const eased    = 1 - Math.pow(1 - progress, 3);
    current        = Math.round(eased * target);
    el.innerHTML   = `${current}<span class="scorecard-overall-suffix">%</span>`;
    if (progress < 1) requestAnimationFrame(update);
  }
  requestAnimationFrame(update);
}

// ═══════════════════════════════════════════════════
// SIDEBAR / UI NAVIGATION
// ═══════════════════════════════════════════════════

function resetToHome() {
  if (isRunning) return; // don't interrupt an active pipeline run
  document.querySelectorAll('.stage-panel').forEach(p => p.classList.remove('visible'));
  document.getElementById('welcomeState').style.display = '';
  // Sidebar completion states are preserved — user can still click completed stages
  document.querySelectorAll('.stage-nav-item').forEach(item => {
    if (!item.classList.contains('completed')) item.classList.remove('active');
  });
  closeSidebar();
}

function toggleSidebar() {
  const sidebar  = document.getElementById('sidebar') || document.querySelector('.sidebar');
  const backdrop = document.getElementById('sidebarBackdrop');
  const isOpen   = sidebar.classList.toggle('open');
  backdrop.classList.toggle('open', isOpen);
  document.getElementById('sidebarToggle').textContent = isOpen ? '✕' : '☰';
}

function closeSidebar() {
  const sidebar  = document.querySelector('.sidebar');
  const backdrop = document.getElementById('sidebarBackdrop');
  if (!sidebar) return;
  sidebar.classList.remove('open');
  backdrop.classList.remove('open');
  const toggle = document.getElementById('sidebarToggle');
  if (toggle) toggle.textContent = '☰';
}

function viewStage(stage) {
  if (!stageOutputs[stage] && !isRunning) return;
  document.querySelectorAll('.stage-panel').forEach(p => p.classList.remove('visible'));
  document.getElementById('welcomeState').style.display = 'none';
  const panel = document.getElementById(`stagePanel${stage}`);
  if (panel) panel.classList.add('visible');
  document.querySelectorAll('.stage-nav-item').forEach(item => {
    if (!item.classList.contains('completed') && !item.classList.contains('running')) {
      item.classList.remove('active');
    }
  });
  document.querySelector(`.stage-nav-item[data-stage="${stage}"]`).classList.add('active');
  closeSidebar(); // close drawer on mobile after navigation
}

function togglePrompt(stage) {
  document.getElementById(`promptViewer${stage}`).classList.toggle('open');
}

// ═══════════════════════════════════════════════════
// COPY FUNCTIONS
// ═══════════════════════════════════════════════════

function copyBlog() {
  const text = document.getElementById('stageOutput4').innerText;
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.querySelector('#blogActions .primary');
    btn.textContent = '✅ Copied!';
    setTimeout(() => { btn.innerHTML = '📋 Copy Blog'; }, 2000);
  });
}

function copyMarkdown() {
  const md = stageRawMarkdown[4] || '';
  navigator.clipboard.writeText(md).then(() => {
    const btns = document.querySelectorAll('#blogActions .blog-action-btn');
    btns[1].textContent = '✅ Copied!';
    setTimeout(() => { btns[1].innerHTML = '📄 Copy Markdown'; }, 2000);
  });
}

// ═══════════════════════════════════════════════════
// ERROR UI
// ═══════════════════════════════════════════════════

function showError(msg) {
  const banner = document.getElementById('errorBanner');
  document.getElementById('errorText').textContent = msg;
  banner.classList.add('visible');
}

function hideError() {
  document.getElementById('errorBanner').classList.remove('visible');
}

// ═══════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}

// ═══════════════════════════════════════════════════
// EVENT LISTENERS
// ═══════════════════════════════════════════════════

// Close modal on overlay click
document.getElementById('apiModal').addEventListener('click', function(e) {
  if (e.target === this) closeApiModal();
});

// Enter key in keyword input
document.getElementById('keywordInput').addEventListener('keydown', function(e) {
  if (e.key === 'Enter' && !isRunning) startPipeline();
});

// Ctrl/Cmd + Enter to generate
document.addEventListener('keydown', function(e) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !isRunning) startPipeline();
});

// ═══════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════

if (typeof marked !== 'undefined') {
  marked.setOptions({ breaks: true, gfm: true });
}

// ═══════════════════════════════════════════════════
// THEME
// ═══════════════════════════════════════════════════

function toggleTheme() {
  const html   = document.documentElement;
  const isDark = html.getAttribute('data-theme') === 'dark';
  const next   = isDark ? 'light' : 'dark';
  html.setAttribute('data-theme', next);
  document.getElementById('themeToggle').textContent = next === 'dark' ? '☀️' : '🌙';
  try { localStorage.setItem('blogy-theme', next); } catch (_) {}
}

// Init theme from localStorage
(function initTheme() {
  let saved;
  try { saved = localStorage.getItem('blogy-theme'); } catch (_) {}
  const theme = saved || 'light';
  document.documentElement.setAttribute('data-theme', theme);
  const btn = document.getElementById('themeToggle');
  if (btn) btn.textContent = theme === 'dark' ? '☀️' : '🌙';
})();
