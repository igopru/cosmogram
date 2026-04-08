#!/usr/bin/env node
/**
 * Cosmogram Thumbnail Generator
 * 
 * Generates high-quality WebP thumbnails from original media files.
 * Replaces low-quality pre-generated thumbnails with sharp-optimized ones.
 * 
 * Usage:
 *   node scripts/generate-thumbnails.js              - Regenerate all thumbnails
 *   node scripts/generate-thumbnails.js --folder FOLDER_NAME  - Regenerate for specific folder
 *   node scripts/generate-thumbnails.js --dry-run     - Preview without generating
 *   node scripts/generate-thumbnails.js --force       - Regenerate even if thumb exists
 * 
 * Configuration below in CONFIG.
 */

import 'dotenv/config';
import path from 'path';
import fs from 'fs';
import sharp from 'sharp';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================
// CONFIGURATION
// ============================================================
const CONFIG = {
    sourceDir: '/opt/media/files/',
    thumbOutputDir: '/opt/media/thumbs/',
    width: 600,
    quality: 80,
    recursive: true,
    allowedImageTypes: ['.jpg', '.jpeg', '.png', '.webp', '.gif'],
    force: false,
    dryRun: false,
    folder: null,  // null = all folders
};

// ============================================================
// Helpers
// ============================================================

function isAllowedType(filename) {
    const ext = path.extname(filename).toLowerCase();
    return CONFIG.allowedImageTypes.includes(ext);
}

function getThumbOutputPath(sourcePath) {
    const relativePath = path.relative(CONFIG.sourceDir, sourcePath);
    const relativeDir = path.dirname(relativePath);
    const baseName = path.basename(sourcePath, path.extname(sourcePath));
    return path.join(CONFIG.thumbOutputDir, relativeDir, `${baseName}.thumb.webp`);
}

function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

// ============================================================
// Main Functions
// ============================================================

async function generateThumbnail(sourcePath, thumbPath, options = {}) {
    const { force = false, dryRun = false } = options;
    
    // Check if thumbnail already exists
    if (fs.existsSync(thumbPath) && !force) {
        const stats = fs.statSync(thumbPath);
        return { status: 'exists', size: stats.size, path: thumbPath };
    }
    
    if (dryRun) {
        return { status: 'would_generate', path: thumbPath };
    }
    
    try {
        // Ensure output directory exists
        const outputDir = path.dirname(thumbPath);
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }
        
        // Generate thumbnail with sharp
        await sharp(sourcePath)
            .resize(CONFIG.width, CONFIG.height, {
                fit: 'inside',
                withoutEnlargement: true,
            })
            .webp({
                quality: CONFIG.quality,
                effort: 6,  // Higher effort = better compression (0-6)
            })
            .toFile(thumbPath);
        
        const stats = fs.statSync(thumbPath);
        return { status: 'generated', size: stats.size, path: thumbPath };
    } catch (error) {
        return { status: 'error', error: error.message, path: thumbPath };
    }
}

async function processFolder(folderPath) {
    console.log(`\n📁 Processing folder: ${folderPath}`);
    console.log('═'.repeat(60));
    
    const results = {
        total: 0,
        generated: 0,
        exists: 0,
        errors: 0,
        wouldGenerate: 0,
        totalSourceSize: 0,
        totalThumbSize: 0,
    };
    
    function scanDir(dir) {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            
            if (entry.isDirectory() && CONFIG.recursive) {
                scanDir(fullPath);
            } else if (entry.isFile() && isAllowedType(entry.name)) {
                results.total++;
                
                const sourceStats = fs.statSync(fullPath);
                results.totalSourceSize += sourceStats.size;
                
                const thumbPath = getThumbOutputPath(fullPath);
                
                // Process
                generateThumbnail(fullPath, thumbPath, {
                    force: CONFIG.force,
                    dryRun: CONFIG.dryRun,
                }).then(result => {
                    if (result.status === 'generated') {
                        results.generated++;
                        results.totalThumbSize += result.size;
                        process.stdout.write('✅');
                    } else if (result.status === 'exists') {
                        results.exists++;
                        results.totalThumbSize += result.size;
                        process.stdout.write('⏭️');
                    } else if (result.status === 'would_generate') {
                        results.wouldGenerate++;
                        process.stdout.write('🔶');
                    } else if (result.status === 'error') {
                        results.errors++;
                        process.stdout.write('❌');
                        console.error(`\n   Error: ${result.error}`);
                    }
                    
                    // Progress every 10 files
                    if (results.total % 10 === 0) {
                        process.stdout.write(`\n   ${results.total} files processed...\n`);
                    }
                });
            }
        }
    }
    
    scanDir(folderPath);
    
    // Wait a bit for all promises to complete (simple approach)
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    return results;
}

async function main() {
    console.log('╔═══════════════════════════════════════════════════════╗');
    console.log('║  Cosmogram Thumbnail Generator                        ║');
    console.log('╚═══════════════════════════════════════════════════════╝');
    console.log(`\n⚙️  Settings:`);
    console.log(`   Source: ${CONFIG.sourceDir}`);
    console.log(`   Output: ${CONFIG.thumbOutputDir}`);
    console.log(`   Size: ${CONFIG.width}px`);
    console.log(`   Quality: ${CONFIG.quality}`);
    console.log(`   Force: ${CONFIG.force}`);
    console.log(`   Dry Run: ${CONFIG.dryRun}`);
    
    // Ensure output directory exists
    if (!fs.existsSync(CONFIG.thumbOutputDir)) {
        fs.mkdirSync(CONFIG.thumbOutputDir, { recursive: true });
    }
    
    const startTime = Date.now();
    
    if (CONFIG.folder) {
        // Process specific folder
        const folderPath = path.join(CONFIG.sourceDir, CONFIG.folder);
        if (!fs.existsSync(folderPath)) {
            console.error(`\n❌ Folder not found: ${folderPath}`);
            process.exit(1);
        }
        
        const results = await processFolder(folderPath);
        printResults(results);
    } else {
        // Process all folders
        const results = {
            total: 0,
            generated: 0,
            exists: 0,
            errors: 0,
            wouldGenerate: 0,
            totalSourceSize: 0,
            totalThumbSize: 0,
        };
        
        const entries = fs.readdirSync(CONFIG.sourceDir, { withFileTypes: true });
        const folders = entries.filter(e => e.isDirectory()).map(e => e.name);
        
        console.log(`\n📂 Found ${folders.length} folders to process:`);
        folders.forEach(f => console.log(`   • ${f}`));
        
        for (const folder of folders) {
            const folderPath = path.join(CONFIG.sourceDir, folder);
            const folderResults = await processFolder(folderPath);
            
            results.total += folderResults.total;
            results.generated += folderResults.generated;
            results.exists += folderResults.exists;
            results.errors += folderResults.errors;
            results.wouldGenerate += folderResults.wouldGenerate;
            results.totalSourceSize += folderResults.totalSourceSize;
            results.totalThumbSize += folderResults.totalThumbSize;
        }
        
        printResults(results);
    }
    
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n⏱️  Total time: ${elapsed}s`);
}

function printResults(results) {
    console.log('\n');
    console.log('═'.repeat(60));
    console.log('  Results');
    console.log('═'.repeat(60));
    console.log(`   Total files:     ${results.total}`);
    
    if (CONFIG.dryRun) {
        console.log(`   Would generate:  ${results.wouldGenerate}`);
        console.log(`   Already exists:  ${results.exists}`);
    } else {
        console.log(`   Generated:       ${results.generated}`);
        console.log(`   Skipped:         ${results.exists}`);
    }
    
    console.log(`   Errors:          ${results.errors}`);
    console.log(`   Source size:     ${formatBytes(results.totalSourceSize)}`);
    console.log(`   Thumb size:      ${formatBytes(results.totalThumbSize)}`);
    
    if (results.totalSourceSize > 0) {
        const ratio = ((results.totalThumbSize / results.totalSourceSize) * 100).toFixed(1);
        console.log(`   Compression:     ${ratio}% of original`);
    }
    
    console.log('═'.repeat(60));
    
    if (results.errors > 0) {
        console.log(`\n⚠️  ${results.errors} errors occurred. Check output above for details.`);
    }
}

// ============================================================
// Parse CLI arguments
// ============================================================

const args = process.argv.slice(2);

for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '--dry-run' || arg === '-n') {
        CONFIG.dryRun = true;
    } else if (arg === '--force' || arg === '-f') {
        CONFIG.force = true;
    } else if (arg === '--folder' || arg === '-d') {
        CONFIG.folder = args[++i];
    } else if (arg === '--width' || arg === '-w') {
        CONFIG.width = parseInt(args[++i], 10);
    } else if (arg === '--quality' || arg === '-q') {
        CONFIG.quality = parseInt(args[++i], 10);
    } else if (arg === '--help' || arg === '-h') {
        console.log(`
Usage: node scripts/generate-thumbnails.js [options]

Options:
  --folder, -d FOLDER   Process specific folder only
  --width, -w PIXELS    Thumbnail width (default: 600)
  --quality, -q LEVEL   WebP quality 0-100 (default: 80)
  --force, -f           Regenerate even if thumbnail exists
  --dry-run, -n         Preview without generating
  --help, -h            Show this help

Examples:
  node scripts/generate-thumbnails.js                    # All folders
  node scripts/generate-thumbnails.js --folder vacation  # Specific folder
  node scripts/generate-thumbnails.js --dry-run          # Preview only
  node scripts/generate-thumbnails.js --force --quality 90  # High quality regen
`);
        process.exit(0);
    }
}

// ============================================================
// Run
// ============================================================

main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
