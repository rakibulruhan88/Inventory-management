// Alias keeps invoice uploads on a pinned patched release independently of Nest's helper.
declare module 'invoice-multipart' {
  import multer from 'multer';
  export default multer;
}
