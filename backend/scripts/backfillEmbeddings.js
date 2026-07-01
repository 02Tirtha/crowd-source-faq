/**
 * Regenerate all FAQ and CommunityPost embeddings.
 * Run: npx tsx scripts/backfillEmbeddings.ts
 *
 * IMPORTANT: If you change the model in utils/embeddings.ts,
 * you MUST run this script and update your Atlas vector index numDimensions.
 *
 * v1.68 — model name updated to mxbai-embed-large-v1 (1024-dim).
 * The actual embedding call now routes through the HF
 * Inference API when HUGGINGFACE_API_KEY is set, and
 * falls back to the in-process @huggingface/transformers
 * pipeline otherwise. Cursor iteration was rewritten to
 * toArray() + plain for-of to avoid a Mongoose async-
 * iterator native crash (libc++abi mutex) that happened
 * around the 101st doc.
 */
import dotenv from 'dotenv';
dotenv.config();
dotenv.config({ path: '.env.local' });
import mongoose from 'mongoose';
import { generateEmbedding, EMBEDDING_DIM, MODEL_SLUG } from '../utils/ai/embeddings.js';
const FAQ_COLL = 'yaksha_faq_faqs';
const COMM_COLL = 'yaksha_faq_communityposts';
async function main() {
    if (!process.env.MONGODB_URI) {
        console.error('MONGODB_URI not set.');
        process.exit(1);
    }
    const usingApi = !!process.env.HUGGINGFACE_API_KEY?.trim();
    console.log(`Model: ${MODEL_SLUG} (${EMBEDDING_DIM}-dim, ${usingApi ? 'HF Inference API' : 'in-process ONNX'})`);
    await mongoose.connect(process.env.MONGODB_URI);
    const db = mongoose.connection.db;
    const faqColl = db.collection(FAQ_COLL);
    const commColl = db.collection(COMM_COLL);
    console.log('Loading FAQs…');
    const faqs = (await faqColl.find({ embedding: { $exists: true, $ne: null } }).toArray());
    console.log(`  ${faqs.length} FAQs to re-embed`);
    let fp = 0, fe = 0;
    for (const faq of faqs) {
        try {
            const embedding = await generateEmbedding(`Section: ${faq.category}. Question: ${faq.question}. Answer: ${faq.answer}`);
            await faqColl.updateOne({ _id: faq._id }, { $set: { embedding } });
            fp++;
            process.stdout.write(`\r  FAQs: ${fp}/${faqs.length}   `);
        }
        catch (err) {
            fe++;
            console.error(`\n  [backfill] Failed to generate embedding for FAQ ${faq._id}: ${err.message}`);
        }
    }
    console.log(`\n  ✓ ${fp} FAQs${fe ? `, ${fe} errors` : ''}`);
    console.log('Loading posts…');
    const posts = (await commColl.find({ embedding: { $exists: true, $ne: null } }).toArray());
    console.log(`  ${posts.length} posts to re-embed`);
    let cp = 0, ce = 0;
    for (const post of posts) {
        try {
            const embedding = await generateEmbedding(`Question: ${post.title}. Description: ${post.body}`);
            await commColl.updateOne({ _id: post._id }, { $set: { embedding } });
            cp++;
            process.stdout.write(`\r  Posts: ${cp}/${posts.length}   `);
        }
        catch (err) {
            ce++;
            console.error(`\n  [backfill] Failed to generate embedding for Post ${post._id}: ${err.message}`);
        }
    }
    console.log(`\n  ✓ ${cp} posts${ce ? `, ${ce} errors` : ''}`);
    console.log('\n✅ Backfill complete!');
    await mongoose.disconnect();
    // Don't process.exit — let the event loop drain so
    // the @huggingface/transformers native runtime can
    // clean up without aborting. The loop is empty now
    // (no pending I/O, no keep-alive sockets) so the
    // process will exit naturally on next tick.
}
main().catch((err) => { console.error(err.message); process.exit(1); });
