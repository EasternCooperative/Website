// /api/internal/engagement/*: the same handler as /api/internal/leadership/*, under the
// tool's new name. Both paths stay live so nothing breaks while people move over.
export { onRequest } from '../leadership/[[path]].js';
