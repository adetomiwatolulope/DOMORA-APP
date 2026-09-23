/**
 * convert-design-tokens.js
 * 
 * This script converts the design system information exported from Figma 
 * (e.g. design-tokens.tokens (1).json) into CSS Custom Properties (CSS variables)
 * and utility classes.
 * 
 * Rules Adhered To:
 * - DS-3 & DS-4: Exact token names are used and generated cleanly.
 * - Colour System: 
 *   - Primitive Colours: Form the foundation of the design system. They are 
 *     generated as CSS variables (e.g. --primitive-...) but should NOT be 
 *     applied directly to UI components.
 *   - Colour Roles: These map to primitive colours (via Figma aliases) and 
 *     are the intended colours for use in UI components (e.g. --color-role-...).
 * - Spacing: Strips trailing "-spacing" and standardizes dimension units.
 * - Typography (DS-6): Generates dedicated typography classes for complete 
 *   style applications (e.g. .typography-display-large). It also automatically 
 *   injects the generic fallback to font-family (serif for Lora, sans-serif for DM Sans).
 */

const fs = require('fs');
const path = require('path');

/**
 * Helper to convert strings to kebab-case
 * @param {string} str - String to convert
 * @returns {string} - Kebab-cased string
 */
function toKebabCase(str) {
  return str.toLowerCase().replace(/[\s_]+/g, '-');
}

/**
 * Format a dimension value safely, appending 'px' where required.
 * @param {string|number} val - Dimension value from the tokens
 * @returns {string} - CSS-safe dimension string
 */
function toDimension(val) {
  if (typeof val === 'number') {
    return val === 0 ? '0' : `${val}px`;
  }
  if (typeof val === 'string' && /^[0-9.]+$/.test(val)) {
    return `${val}px`;
  }
  return val;
}

/**
 * Resolves Figma token aliases (e.g. "{primitives.key colors.primary key color}")
 * to CSS variables (e.g. "var(--primitive-key-colors-primary-key-color)")
 * @param {string} value - The raw token value
 * @returns {string} - The resolved CSS variable or the original value
 */
function resolveAlias(value) {
  if (typeof value === 'string' && value.startsWith('{') && value.endsWith('}')) {
    const inner = value.slice(1, -1);
    let cssVar = inner.split('.').map(toKebabCase).join('-');
    
    // Standardize 'primitives' prefix to singular 'primitive' for cleaner CSS matching DS rules
    if (cssVar.startsWith('primitives-')) {
      cssVar = cssVar.replace(/^primitives-/, 'primitive-');
    }
    return `var(--${cssVar})`;
  }
  return value;
}

/**
 * Parses and processes the Primitive Colours.
 * @param {Object} primitives - The primitives object from tokens.
 * @returns {string} - CSS declarations for primitive colours.
 */
function processPrimitives(primitives) {
  let css = '  /* \n   * Primitive Colors\n   * FOUNDATION ONLY - DO NOT APPLY DIRECTLY ON UI\n   */\n';
  for (const [groupName, tokens] of Object.entries(primitives)) {
    for (const [key, token] of Object.entries(tokens)) {
      if (token.type === 'color') {
        const cssName = `--primitive-${toKebabCase(groupName)}-${toKebabCase(key)}`;
        css += `  ${cssName}: ${token.value};\n`;
      }
    }
  }
  return css;
}

/**
 * Parses and processes the Colour Roles.
 * @param {Object} roles - The colour roles object from tokens.
 * @returns {string} - CSS declarations for colour roles.
 */
function processColorRoles(roles) {
  let css = '  /* \n   * Color Roles\n   * APPLIED DIRECTLY ON UI (MAPPED TO PRIMITIVES)\n   */\n';
  for (const [key, token] of Object.entries(roles)) {
    if (token.type === 'color') {
      const cssName = `--color-role-${toKebabCase(key)}`;
      const cssValue = resolveAlias(token.value);
      css += `  ${cssName}: ${cssValue};\n`;
    }
  }
  return css;
}

/**
 * Parses and processes the Spacing System.
 * @param {Object} spacing - The spacing system object from tokens.
 * @returns {string} - CSS declarations for spacing variables.
 */
function processSpacing(spacing) {
  let css = '  /* Spacing System */\n';
  for (const [key, token] of Object.entries(spacing)) {
    if (token.type === 'dimension') {
      let name = toKebabCase(key);
      // Remove trailing '-spacing' for cleaner variables like '--spacing-extremely-small'
      name = name.replace(/-spacing$/, '');
      const cssName = `--spacing-${name}`;
      css += `  ${cssName}: ${toDimension(token.value)};\n`;
    }
  }
  return css;
}

/**
 * Parses and processes the Effects (Shadows).
 * @param {Object} effects - The effects object from tokens.
 * @returns {string} - CSS declarations for box-shadows.
 */
function processEffects(effects) {
  let css = '  /* Effects / Shadows */\n';
  for (const [key, token] of Object.entries(effects)) {
    if (token.type === 'custom-shadow') {
      const cssName = `--effect-${toKebabCase(key)}`;
      const { offsetX, offsetY, radius, spread, color } = token.value;
      const shadowStr = `${toDimension(offsetX)} ${toDimension(offsetY)} ${toDimension(radius)} ${toDimension(spread)} ${color}`;
      css += `  ${cssName}: ${shadowStr};\n`;
    }
  }
  return css;
}

/**
 * Parses and processes Typography to generate utility classes.
 * @param {Object} typography - The typography object from tokens.
 * @returns {string} - CSS classes for typography styles.
 */
function processTypography(typography) {
  let css = '/* \n * Typography Classes \n * Defines complete type styles to be used as whole classes (DS-6)\n */\n';
  for (const [category, styles] of Object.entries(typography)) {
    for (const [size, token] of Object.entries(styles)) {
      css += `.typography-${toKebabCase(category)}-${toKebabCase(size)} {\n`;
      
      const props = [];
      if (token.fontFamily) {
        let family = token.fontFamily.value;
        const normalizedFamily = family.toLowerCase().replace(/\s/g, '');
        // Apply generic fallbacks per design system rules (DS-6)
        if (normalizedFamily === 'lora') {
          family = `'Lora', serif`;
        } else if (normalizedFamily === 'dmsans') {
          family = `'DM Sans', sans-serif`;
        } else {
          family = `'${family}', sans-serif`; // safe fallback
        }
        props.push(`font-family: ${family}`);
      }
      
      if (token.fontSize) props.push(`font-size: ${toDimension(token.fontSize.value)}`);
      if (token.fontWeight) props.push(`font-weight: ${token.fontWeight.value}`);
      if (token.lineHeight) props.push(`line-height: ${toDimension(token.lineHeight.value)}`);
      if (token.letterSpacing) props.push(`letter-spacing: ${toDimension(token.letterSpacing.value)}`);
      if (token.textDecoration && token.textDecoration.value !== 'none') {
        props.push(`text-decoration: ${token.textDecoration.value}`);
      }
      if (token.textCase && token.textCase.value !== 'none') {
        props.push(`text-transform: ${token.textCase.value}`);
      }
      if (token.fontStyle && token.fontStyle.value !== 'normal') {
        props.push(`font-style: ${token.fontStyle.value}`);
      }
      
      css += props.map(p => `  ${p};\n`).join('');
      css += `}\n\n`;
    }
  }
  return css;
}

/**
 * Orchestrates the conversion of tokens into the final CSS string.
 * @param {Object} tokens - Parsed JSON tokens.
 * @returns {string} - The complete CSS string.
 */
function generateCSS(tokens) {
  let css = ':root {\n';
  
  if (tokens.primitives) {
    css += processPrimitives(tokens.primitives) + '\n';
  }
  if (tokens['color roles']) {
    css += processColorRoles(tokens['color roles']) + '\n';
  }
  if (tokens['spacing system']) {
    css += processSpacing(tokens['spacing system']) + '\n';
  }
  if (tokens.effect) {
    css += processEffects(tokens.effect) + '\n';
  }
  
  css += '}\n\n';
  
  if (tokens.typography) {
    css += processTypography(tokens.typography);
  }
  
  return css;
}

/**
 * Main execution block. Reads the JSON file, parses it, and writes the CSS.
 */
function main() {
  const inputFile = path.join(__dirname, 'design-tokens.tokens (1).json');
  const outputFile = path.join(__dirname, 'variable.css'); 
  
  try {
    if (!fs.existsSync(inputFile)) {
      throw new Error(`Input file not found: ${inputFile}`);
    }
    
    const rawData = fs.readFileSync(inputFile, 'utf-8');
    const tokens = JSON.parse(rawData);
    
    const css = generateCSS(tokens);
    
    fs.writeFileSync(outputFile, css, 'utf-8');
    console.log(`✅ Successfully generated CSS from design tokens: ${outputFile}`);
  } catch (error) {
    console.error(`❌ Error parsing design tokens:`, error.message);
    process.exit(1);
  }
}

main();
