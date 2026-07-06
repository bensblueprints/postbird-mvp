// Pure block-JSON → { html, text } email compiler.
// Email-safe by construction: table-based layout, inline styles only,
// no flexbox/grid/position, bulletproof buttons (padded table cells), alt text,
// and an auto-generated plain-text alternative.
//
// Merge tags {{name}} {{email}} {{unsubscribe_url}} are left in the output and
// substituted per-recipient at send time (see sender.js).

const DEFAULT_GLOBAL = {
  width: 600,
  bgColor: '#f4f4f5',
  bodyColor: '#ffffff',
  textColor: '#27272a',
  linkColor: '#4f46e5',
  font: "Arial, 'Helvetica Neue', Helvetica, sans-serif"
};

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Minimal inline rich text: **bold**, *italic*, [text](url). Everything else escaped.
function richText(s, linkColor) {
  let out = esc(s);
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
    (m, txt, url) => `<a href="${esc(url)}" style="color:${linkColor};text-decoration:underline;" target="_blank">${txt}</a>`);
  out = out.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  out = out.replace(/\*([^*]+)\*/g, '<i>$1</i>');
  out = out.replace(/\n/g, '<br />');
  return out;
}

function stripToText(s) {
  return String(s ?? '')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '$1 ($2)')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1');
}

function row(inner) {
  return `<tr>${inner}</tr>`;
}

function cellPad(styles) {
  return `padding:${styles.padding ?? '12px 32px'};`;
}

function renderBlock(block, g) {
  const s = block.styles || {};
  const color = s.color || g.textColor;
  const align = s.align || 'left';
  switch (block.type) {
    case 'heading': {
      const size = s.size || 28;
      return row(
        `<td style="${cellPad(s)}text-align:${align};font-family:${g.font};color:${color};font-size:${size}px;line-height:1.25;font-weight:bold;">${richText(block.text || '', g.linkColor)}</td>`
      );
    }
    case 'text': {
      const size = s.size || 15;
      return row(
        `<td style="${cellPad(s)}text-align:${align};font-family:${g.font};color:${color};font-size:${size}px;line-height:1.6;">${richText(block.text || '', g.linkColor)}</td>`
      );
    }
    case 'image': {
      const src = block.src || '';
      if (!src) return '';
      const w = s.width || g.width - 64;
      const img = `<img src="${esc(src)}" alt="${esc(block.alt || '')}" width="${w}" style="display:block;width:100%;max-width:${w}px;height:auto;border:0;" />`;
      const wrapped = block.href
        ? `<a href="${esc(block.href)}" target="_blank" style="text-decoration:none;">${img}</a>`
        : img;
      return row(`<td style="${cellPad(s)}text-align:${align};">${wrapped}</td>`);
    }
    case 'button': {
      // Bulletproof button: padded table cell with bgcolor, no VML (documented Outlook caveat).
      const bg = s.bgColor || g.linkColor;
      const fg = s.color || '#ffffff';
      const radius = s.radius ?? 6;
      const href = block.href || '#';
      return row(
        `<td style="${cellPad(s)}text-align:${align};">` +
          `<table role="presentation" border="0" cellpadding="0" cellspacing="0" align="${align === 'center' ? 'center' : 'left'}" style="margin:${align === 'center' ? '0 auto' : '0'};"><tr>` +
          `<td bgcolor="${bg}" style="background-color:${bg};border-radius:${radius}px;">` +
          `<a href="${esc(href)}" target="_blank" style="display:inline-block;padding:12px 28px;font-family:${g.font};font-size:15px;font-weight:bold;color:${fg};text-decoration:none;border-radius:${radius}px;">${esc(block.text || 'Click here')}</a>` +
          `</td></tr></table></td>`
      );
    }
    case 'divider':
      return row(
        `<td style="${cellPad({ padding: s.padding ?? '16px 32px' })}"><table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0"><tr><td style="border-top:1px solid ${s.color || '#e4e4e7'};font-size:0;line-height:0;">&nbsp;</td></tr></table></td>`
      );
    case 'spacer':
      return row(`<td style="height:${s.height || 24}px;font-size:0;line-height:0;">&nbsp;</td>`);
    case 'columns': {
      const left = richText(block.left || '', g.linkColor);
      const right = richText(block.right || '', g.linkColor);
      const size = s.size || 15;
      const half = Math.floor((g.width - 64) / 2) - 8;
      const cell = (content) =>
        `<td width="${half}" valign="top" style="width:${half}px;font-family:${g.font};color:${color};font-size:${size}px;line-height:1.6;">${content}</td>`;
      return row(
        `<td style="${cellPad(s)}"><table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0"><tr>` +
          cell(left) +
          `<td width="16" style="width:16px;font-size:0;">&nbsp;</td>` +
          cell(right) +
          `</tr></table></td>`
      );
    }
    case 'footer': {
      // Compliance footer — non-removable in campaign sends (enforced by the compiler).
      const size = s.size || 12;
      const fg = s.color || '#71717a';
      return row(
        `<td style="padding:${s.padding ?? '20px 32px 28px'};text-align:center;font-family:${g.font};color:${fg};font-size:${size}px;line-height:1.7;">` +
          `${richText(block.text || '', g.linkColor)}${block.text ? '<br />' : ''}` +
          `{{physical_address}}<br />` +
          `<a href="{{unsubscribe_url}}" style="color:${fg};text-decoration:underline;" target="_blank">Unsubscribe</a>` +
          `</td>`
      );
    }
    default:
      return '';
  }
}

function blockToText(block) {
  switch (block.type) {
    case 'heading':
      return `${stripToText(block.text).toUpperCase()}\n`;
    case 'text':
      return `${stripToText(block.text)}\n`;
    case 'image':
      return block.alt ? `[${block.alt}]\n` : '';
    case 'button':
      return `${stripToText(block.text || 'Click here')}: ${block.href || ''}\n`;
    case 'divider':
      return '----------------------------------------\n';
    case 'columns':
      return `${stripToText(block.left)}\n${stripToText(block.right)}\n`;
    case 'footer':
      return `${stripToText(block.text || '')}\n{{physical_address}}\nUnsubscribe: {{unsubscribe_url}}\n`;
    default:
      return '';
  }
}

/**
 * compile(blocks, opts) → { html, text }
 * opts.global      — global style overrides
 * opts.enforceFooter — when true (campaign sends), a footer block is appended if missing.
 */
function compile(blocks, opts = {}) {
  const g = { ...DEFAULT_GLOBAL, ...(opts.global || {}) };
  let list = Array.isArray(blocks) ? blocks.slice() : [];
  const hasFooter = list.some((b) => b && b.type === 'footer');
  if (opts.enforceFooter !== false && !hasFooter) {
    list.push({ type: 'footer', text: '' });
  }

  const rows = list.map((b) => renderBlock(b, g)).join('\n');
  const html = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title></title>
</head>
<body style="margin:0;padding:0;background-color:${g.bgColor};">
<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" bgcolor="${g.bgColor}" style="background-color:${g.bgColor};">
<tr><td align="center" style="padding:24px 8px;">
<table role="presentation" width="${g.width}" border="0" cellpadding="0" cellspacing="0" bgcolor="${g.bodyColor}" style="width:${g.width}px;max-width:100%;background-color:${g.bodyColor};border-radius:8px;">
${rows}
</table>
</td></tr>
</table>
</body>
</html>`;

  const text = list.map(blockToText).filter(Boolean).join('\n').trim() + '\n';
  return { html, text };
}

module.exports = { compile, DEFAULT_GLOBAL };
