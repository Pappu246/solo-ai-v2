-- Allow common source-code MIME types in the private knowledge bucket.
UPDATE storage.buckets
SET allowed_mime_types = ARRAY[
  'application/pdf',
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/json',
  'text/x-python',
  'text/x-script.python',
  'text/javascript',
  'application/javascript',
  'application/typescript',
  'text/x-c',
  'text/x-c++',
  'text/x-java-source',
  'application/xml',
  'text/xml'
]
WHERE id = 'knowledge';
