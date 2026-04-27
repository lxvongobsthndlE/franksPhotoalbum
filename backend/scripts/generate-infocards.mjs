#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import sharp from "sharp";

const DEFAULT_SIZE = 1080;

const DESIGN_CONFIG = {
  cardRadius: 42,
  cardPadding: 56,
  cardMargin: 70,
  accentBarWidth: 12,
  accentBarInset: 30,
  topRowHeight: 120,
  footerMinHeight: 84,
  footerPaddingY: 18,
  footerPaddingX: 22,
  contentGap: {
    titleToSubtitle: 18,
    subtitleToBullets: 28,
    bulletGap: 16,
  },
  typography: {
    fontFamily: "Noto Sans, Segoe UI, Arial, sans-serif",
    title: { size: 58, weight: 700, lineHeight: 1.1, color: "#111827" },
    subtitle: { size: 33, weight: 500, lineHeight: 1.2, color: "#374151" },
    bullet: { size: 31, weight: 500, lineHeight: 1.28, color: "#111827" },
    footer: { size: 25, weight: 600, lineHeight: 1.2, color: "#1f2937" },
    icon: { size: 70, weight: 700, lineHeight: 1.0, color: "#111827" },
  },
  variants: {
    update: {
      canvasBg: "#EAF2FF",
      canvasBgTo: "#F8FAFF",
      cardBg: "#FFFFFF",
      accent: "#2F6BFF",
      iconBg: "#DBE8FF",
      footerBg: "#E5EEFF",
    },
    announcement: {
      canvasBg: "#FFF4E8",
      canvasBgTo: "#FFF9F1",
      cardBg: "#FFFFFF",
      accent: "#E46B21",
      iconBg: "#FFE8D4",
      footerBg: "#FFECD9",
    },
    tip: {
      canvasBg: "#EBF8F0",
      canvasBgTo: "#F7FCF9",
      cardBg: "#FFFFFF",
      accent: "#1E8D54",
      iconBg: "#DDF5E7",
      footerBg: "#E2F7EA",
    },
  },
};

function parseArgs(argv) {
  const args = {
    input: "scripts/infocards.json",
    output: "generated/infocards",
    size: DEFAULT_SIZE,
    appIcon: "public/media/icon-512x512.png",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];
    const next = argv[i + 1];

    if (current === "--input" && next) {
      args.input = next;
      i += 1;
      continue;
    }

    if (current === "--output" && next) {
      args.output = next;
      i += 1;
      continue;
    }

    if (current === "--size" && next) {
      const parsed = Number.parseInt(next, 10);
      if (!Number.isFinite(parsed) || parsed < 320) {
        throw new Error("--size muss eine Zahl >= 320 sein.");
      }
      args.size = parsed;
      i += 1;
      continue;
    }

    if (current === "--app-icon" && next) {
      args.appIcon = next;
      i += 1;
      continue;
    }
  }

  return args;
}

function slugifyName(name) {
  return String(name || "karte")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizeCards(raw) {
  if (Array.isArray(raw)) {
    return raw;
  }

  if (raw && Array.isArray(raw.cards)) {
    return raw.cards;
  }

  throw new Error("JSON muss ein Array oder ein Objekt mit 'cards' sein.");
}

function validateCard(card, index) {
  const required = ["name", "variant", "icon", "title", "subtitle", "bullets", "footer"];
  for (const key of required) {
    if (card[key] === undefined || card[key] === null) {
      throw new Error(`Datensatz #${index + 1}: Feld '${key}' fehlt.`);
    }
  }

  if (!Array.isArray(card.bullets)) {
    throw new Error(`Datensatz #${index + 1}: 'bullets' muss ein Array sein.`);
  }
}

function ensureVariant(variantKey) {
  const fallback = "update";
  if (DESIGN_CONFIG.variants[variantKey]) {
    return variantKey;
  }
  return fallback;
}

function makeGradientOverlay(size, from, to) {
  return Buffer.from(`
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="${from}"/>
          <stop offset="100%" stop-color="${to}"/>
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="${size}" height="${size}" fill="url(#g)"/>
    </svg>
  `);
}

function makeCardLayer(size, variant) {
  const margin = DESIGN_CONFIG.cardMargin;
  const x = margin;
  const y = margin;
  const width = size - margin * 2;
  const height = size - margin * 2;
  const radius = DESIGN_CONFIG.cardRadius;
  const shadowX = x + 8;
  const shadowY = y + 10;
  const accentX = x + DESIGN_CONFIG.accentBarInset;
  const accentY = y + DESIGN_CONFIG.accentBarInset;
  const accentH = height - DESIGN_CONFIG.accentBarInset * 2;

  return Buffer.from(`
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
      <rect x="${shadowX}" y="${shadowY}" width="${width}" height="${height}" rx="${radius}" fill="rgba(15, 23, 42, 0.14)"/>
      <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}" fill="${variant.cardBg}"/>
      <rect x="${accentX}" y="${accentY}" width="${DESIGN_CONFIG.accentBarWidth}" height="${accentH}" rx="6" fill="${variant.accent}"/>
    </svg>
  `);
}

function makeIconBubbleLayer(size, variant) {
  const margin = DESIGN_CONFIG.cardMargin;
  const x = margin + DESIGN_CONFIG.cardPadding + 10;
  const y = margin + DESIGN_CONFIG.cardPadding - 8;
  const bubbleSize = 84;
  const r = bubbleSize / 2;

  return {
    buffer: Buffer.from(`
      <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
        <circle cx="${x + r}" cy="${y + r}" r="${r}" fill="${variant.iconBg}"/>
      </svg>
    `),
    x,
    y,
    bubbleSize,
  };
}

function makeFooterLayer(size, variant, footerY, footerHeight, footerX, footerWidth) {
  return Buffer.from(`
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
      <rect x="${footerX}" y="${footerY}" width="${footerWidth}" height="${footerHeight}" rx="18" fill="${variant.footerBg}"/>
    </svg>
  `);
}

async function renderTextBlock(text, options) {
  const { width, fontSize, fontWeight, color, fontFamily, lineHeight } = options;
  const spacing = Math.max(0, Math.round(fontSize * (lineHeight - 1)));

  const pngBuffer = await sharp({
    text: {
      text: String(text ?? ""),
      rgba: true,
      width,
      font: `${fontFamily} ${fontWeight} ${fontSize}px`,
      align: "left",
      spacing,
      wrap: "word",
      dpi: 220,
    },
  })
    .png()
    .ensureAlpha()
    .tint(color)
    .toBuffer();

  const meta = await sharp(pngBuffer).metadata();

  return {
    buffer: pngBuffer,
    width: meta.width ?? width,
    height: meta.height ?? fontSize,
  };
}

function scaleTypography(scale) {
  const t = DESIGN_CONFIG.typography;
  const scaleOne = (v) => Math.max(12, Math.round(v * scale));

  return {
    fontFamily: t.fontFamily,
    title: { ...t.title, size: scaleOne(t.title.size) },
    subtitle: { ...t.subtitle, size: scaleOne(t.subtitle.size) },
    bullet: { ...t.bullet, size: scaleOne(t.bullet.size) },
    footer: { ...t.footer, size: scaleOne(t.footer.size) },
    icon: { ...t.icon, size: scaleOne(t.icon.size) },
  };
}

async function buildLayout({ card, size, variant }) {
  const margin = DESIGN_CONFIG.cardMargin;
  const cardWidth = size - margin * 2;
  const cardHeight = size - margin * 2;
  const contentX = margin + DESIGN_CONFIG.cardPadding + 40;
  const contentTop = margin + DESIGN_CONFIG.cardPadding + DESIGN_CONFIG.topRowHeight;
  const contentWidth = cardWidth - DESIGN_CONFIG.cardPadding * 2 - 72;

  const footerX = contentX;
  const footerWidth = contentWidth;

  const scales = [1, 0.95, 0.9, 0.85, 0.8];

  for (const scale of scales) {
    const typography = scaleTypography(scale);

    const title = await renderTextBlock(card.title, {
      width: contentWidth,
      fontSize: typography.title.size,
      fontWeight: typography.title.weight,
      color: typography.title.color,
      fontFamily: typography.fontFamily,
      lineHeight: typography.title.lineHeight,
    });

    const subtitle = await renderTextBlock(card.subtitle, {
      width: contentWidth,
      fontSize: typography.subtitle.size,
      fontWeight: typography.subtitle.weight,
      color: typography.subtitle.color,
      fontFamily: typography.fontFamily,
      lineHeight: typography.subtitle.lineHeight,
    });

    const bulletBlocks = [];
    for (const bullet of card.bullets) {
      const block = await renderTextBlock(`• ${bullet}`, {
        width: contentWidth,
        fontSize: typography.bullet.size,
        fontWeight: typography.bullet.weight,
        color: typography.bullet.color,
        fontFamily: typography.fontFamily,
        lineHeight: typography.bullet.lineHeight,
      });
      bulletBlocks.push(block);
    }

    const footer = await renderTextBlock(card.footer, {
      width: footerWidth - DESIGN_CONFIG.footerPaddingX * 2,
      fontSize: typography.footer.size,
      fontWeight: typography.footer.weight,
      color: typography.footer.color,
      fontFamily: typography.fontFamily,
      lineHeight: typography.footer.lineHeight,
    });

    const icon = await renderTextBlock(card.icon || "i", {
      width: 84,
      fontSize: typography.icon.size,
      fontWeight: typography.icon.weight,
      color: typography.icon.color,
      fontFamily: typography.fontFamily,
      lineHeight: typography.icon.lineHeight,
    });

    const footerHeight = Math.max(
      DESIGN_CONFIG.footerMinHeight,
      footer.height + DESIGN_CONFIG.footerPaddingY * 2,
    );

    const footerY = margin + cardHeight - DESIGN_CONFIG.cardPadding - footerHeight;

    const bulletStartY =
      contentTop +
      title.height +
      DESIGN_CONFIG.contentGap.titleToSubtitle +
      subtitle.height +
      DESIGN_CONFIG.contentGap.subtitleToBullets;

    const bulletAreaBottom = footerY - 20;
    const bulletAreaHeight = bulletAreaBottom - bulletStartY;

    let bulletTotalHeight = 0;
    for (let i = 0; i < bulletBlocks.length; i += 1) {
      bulletTotalHeight += bulletBlocks[i].height;
      if (i < bulletBlocks.length - 1) {
        bulletTotalHeight += DESIGN_CONFIG.contentGap.bulletGap;
      }
    }

    if (bulletAreaHeight >= bulletTotalHeight) {
      return {
        contentX,
        contentTop,
        contentWidth,
        title,
        subtitle,
        bulletBlocks,
        footer,
        footerY,
        footerHeight,
        footerX,
        footerWidth,
        icon,
        typography,
        variant,
      };
    }
  }

  // Fallback: letzte Skala, Bullets abschneiden falls noetig
  const typography = scaleTypography(0.8);
  const title = await renderTextBlock(card.title, {
    width: contentWidth,
    fontSize: typography.title.size,
    fontWeight: typography.title.weight,
    color: typography.title.color,
    fontFamily: typography.fontFamily,
    lineHeight: typography.title.lineHeight,
  });

  const subtitle = await renderTextBlock(card.subtitle, {
    width: contentWidth,
    fontSize: typography.subtitle.size,
    fontWeight: typography.subtitle.weight,
    color: typography.subtitle.color,
    fontFamily: typography.fontFamily,
    lineHeight: typography.subtitle.lineHeight,
  });

  const footer = await renderTextBlock(card.footer, {
    width: footerWidth - DESIGN_CONFIG.footerPaddingX * 2,
    fontSize: typography.footer.size,
    fontWeight: typography.footer.weight,
    color: typography.footer.color,
    fontFamily: typography.fontFamily,
    lineHeight: typography.footer.lineHeight,
  });

  const icon = await renderTextBlock(card.icon || "i", {
    width: 84,
    fontSize: typography.icon.size,
    fontWeight: typography.icon.weight,
    color: typography.icon.color,
    fontFamily: typography.fontFamily,
    lineHeight: typography.icon.lineHeight,
  });

  const footerHeight = Math.max(
    DESIGN_CONFIG.footerMinHeight,
    footer.height + DESIGN_CONFIG.footerPaddingY * 2,
  );
  const footerY = margin + cardHeight - DESIGN_CONFIG.cardPadding - footerHeight;

  const bulletStartY =
    contentTop +
    title.height +
    DESIGN_CONFIG.contentGap.titleToSubtitle +
    subtitle.height +
    DESIGN_CONFIG.contentGap.subtitleToBullets;
  const bulletAreaBottom = footerY - 20;
  const bulletAreaHeight = bulletAreaBottom - bulletStartY;

  const bulletBlocks = [];
  let used = 0;

  for (const bullet of card.bullets) {
    const block = await renderTextBlock(`• ${bullet}`, {
      width: contentWidth,
      fontSize: typography.bullet.size,
      fontWeight: typography.bullet.weight,
      color: typography.bullet.color,
      fontFamily: typography.fontFamily,
      lineHeight: typography.bullet.lineHeight,
    });

    const next = used + block.height + (bulletBlocks.length > 0 ? DESIGN_CONFIG.contentGap.bulletGap : 0);
    if (next > bulletAreaHeight) {
      break;
    }

    used = next;
    bulletBlocks.push(block);
  }

  if (bulletBlocks.length < card.bullets.length) {
    const ellipsis = await renderTextBlock("• ...", {
      width: contentWidth,
      fontSize: typography.bullet.size,
      fontWeight: typography.bullet.weight,
      color: typography.bullet.color,
      fontFamily: typography.fontFamily,
      lineHeight: typography.bullet.lineHeight,
    });

    const next = used + ellipsis.height + (bulletBlocks.length > 0 ? DESIGN_CONFIG.contentGap.bulletGap : 0);
    if (next <= bulletAreaHeight) {
      bulletBlocks.push(ellipsis);
    }
  }

  return {
    contentX,
    contentTop,
    contentWidth,
    title,
    subtitle,
    bulletBlocks,
    footer,
    footerY,
    footerHeight,
    footerX,
    footerWidth,
    icon,
    typography,
    variant,
  };
}

async function createCardImage({ card, size, appIconBuffer }) {
  const variantKey = ensureVariant(card.variant);
  const variant = DESIGN_CONFIG.variants[variantKey];

  const base = sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: variant.canvasBg,
    },
  });

  const overlays = [];

  overlays.push({ input: makeGradientOverlay(size, variant.canvasBg, variant.canvasBgTo), top: 0, left: 0 });
  overlays.push({ input: makeCardLayer(size, variant), top: 0, left: 0 });

  const iconBubble = makeIconBubbleLayer(size, variant);
  overlays.push({ input: iconBubble.buffer, top: 0, left: 0 });

  const layout = await buildLayout({ card, size, variant });

  const iconTextLeft = iconBubble.x + Math.round((iconBubble.bubbleSize - Math.min(layout.icon.width, 72)) / 2);
  const iconTextTop = iconBubble.y + Math.round((iconBubble.bubbleSize - layout.icon.height) / 2) - 2;
  overlays.push({ input: layout.icon.buffer, top: iconTextTop, left: iconTextLeft });

  let yCursor = layout.contentTop;

  overlays.push({ input: layout.title.buffer, top: yCursor, left: layout.contentX });
  yCursor += layout.title.height + DESIGN_CONFIG.contentGap.titleToSubtitle;

  overlays.push({ input: layout.subtitle.buffer, top: yCursor, left: layout.contentX });
  yCursor += layout.subtitle.height + DESIGN_CONFIG.contentGap.subtitleToBullets;

  for (let i = 0; i < layout.bulletBlocks.length; i += 1) {
    const bullet = layout.bulletBlocks[i];
    overlays.push({ input: bullet.buffer, top: yCursor, left: layout.contentX });
    yCursor += bullet.height + DESIGN_CONFIG.contentGap.bulletGap;
  }

  overlays.push({
    input: makeFooterLayer(size, variant, layout.footerY, layout.footerHeight, layout.footerX, layout.footerWidth),
    top: 0,
    left: 0,
  });

  overlays.push({
    input: layout.footer.buffer,
    top: layout.footerY + Math.round((layout.footerHeight - layout.footer.height) / 2),
    left: layout.footerX + DESIGN_CONFIG.footerPaddingX,
  });

  if (appIconBuffer) {
    const appIconSize = 88;
    const margin = DESIGN_CONFIG.cardMargin;
    const cardWidth = size - margin * 2;
    const iconX = margin + cardWidth - DESIGN_CONFIG.cardPadding - appIconSize;
    const iconY = margin + DESIGN_CONFIG.cardPadding - 10;

    const iconBackground = Buffer.from(`
      <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
        <rect x="${iconX}" y="${iconY}" width="${appIconSize}" height="${appIconSize}" rx="22" fill="${variant.iconBg}"/>
      </svg>
    `);

    overlays.push({ input: iconBackground, top: 0, left: 0 });

    const resizedAppIcon = await sharp(appIconBuffer)
      .resize(appIconSize - 18, appIconSize - 18, { fit: "contain" })
      .png()
      .toBuffer();

    overlays.push({ input: resizedAppIcon, top: iconY + 9, left: iconX + 9 });
  }

  return base.composite(overlays).png({ compressionLevel: 9 }).toBuffer();
}

async function loadAppIcon(iconPath) {
  try {
    return await fs.readFile(iconPath);
  } catch {
    return null;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();
  const inputPath = path.resolve(cwd, args.input);
  const outputDir = path.resolve(cwd, args.output);
  const appIconPath = path.resolve(cwd, args.appIcon);

  const raw = await fs.readFile(inputPath, "utf8");
  const cards = normalizeCards(JSON.parse(raw));

  await fs.mkdir(outputDir, { recursive: true });

  const appIconBuffer = await loadAppIcon(appIconPath);

  let generated = 0;
  for (let i = 0; i < cards.length; i += 1) {
    const card = cards[i];
    validateCard(card, i);

    const pngBuffer = await createCardImage({ card, size: args.size, appIconBuffer });
    const fileName = `${slugifyName(card.name)}.png`;
    const outputPath = path.join(outputDir, fileName);

    await fs.writeFile(outputPath, pngBuffer);
    generated += 1;
    console.log(`Erstellt: ${outputPath}`);
  }

  console.log(`Fertig. ${generated} Karten in ${outputDir}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
