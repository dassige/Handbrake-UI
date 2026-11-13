// Every documented route, by area. See ../index.js for what an entry may hold.
import * as auth from './auth.js';
import * as core from './core.js';
import * as jobs from './jobs.js';
import * as tools from './tools.js';
import * as files from './files.js';
import * as media from './media.js';

const AREAS = [auth, core, jobs, tools, files, media];

/** "METHOD /url" → docs entry. */
export const DOCS = Object.assign({}, ...AREAS.map((a) => a.paths));

/** Shared schemas (with $id), referenced as { $ref: 'Name#' }. */
export const SCHEMAS = AREAS.flatMap((a) => a.schemas ?? []);

/** Requests the web app makes, with the shapes it sends: they must pass validation (test/openapi.test.js). */
export const EXAMPLES = AREAS.flatMap((a) => a.examples ?? []);
