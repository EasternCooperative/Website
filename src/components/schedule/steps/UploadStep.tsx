import { useState, useRef, useCallback } from 'react';
import type { Workshop } from '../models';
import { parseExcel, ExcelParseError } from '../excelParser';

interface Props {
  onParsed: (workshops: Workshop[]) => void;
}

export default function UploadStep({ onParsed }: Props) {
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<{ message: string; details?: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback(
    async (file: File) => {
      if (!file.name.endsWith('.xlsx')) {
        setError({ message: 'Please upload an .xlsx file.' });
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const buffer = await file.arrayBuffer();
        const workshops = parseExcel(buffer);
        onParsed(workshops);
      } catch (err) {
        if (err instanceof ExcelParseError) {
          setError({ message: err.message, details: err.details });
        } else {
          setError({ message: 'Unexpected error reading file.' });
        }
      } finally {
        setLoading(false);
      }
    },
    [onParsed]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) processFile(file);
    },
    [processFile]
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) processFile(file);
    },
    [processFile]
  );

  return (
    <div className="mx-auto max-w-xl py-12">
      <h2 className="font-heading mb-2 text-2xl font-bold text-default">Upload Registration Export</h2>
      <p className="mb-6 text-sm text-muted">
        Export the Winter Adventure registration from Cognito Forms as an Excel file and upload it here.
      </p>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={`cursor-pointer rounded-xl border-2 border-dashed px-8 py-16 text-center transition-colors ${
          dragging
            ? 'border-primary bg-primary/5'
            : 'border-gray-300 bg-gray-50 hover:border-primary/40 dark:border-gray-700 dark:bg-gray-900'
        }`}
      >
        <input ref={inputRef} type="file" accept=".xlsx" className="hidden" onChange={handleChange} />
        {loading ? (
          <p className="text-muted">Parsing file…</p>
        ) : (
          <>
            <svg
              className={`mx-auto mb-4 h-12 w-12 transition-colors ${dragging ? 'text-primary' : 'text-gray-300 dark:text-gray-700'}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
            <p className="font-medium text-default">Drop .xlsx file here</p>
            <p className="mt-1 text-sm text-muted">or click to browse</p>
          </>
        )}
      </div>

      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950">
          <p className="font-medium text-red-700 dark:text-red-400">{error.message}</p>
          {error.details && <p className="mt-1 text-sm text-red-500 dark:text-red-400">{error.details}</p>}
        </div>
      )}
    </div>
  );
}
