export function SummaryLine({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-medium text-ink">{label}</div>
      <div className="mt-1 whitespace-pre-wrap rounded-md bg-white px-3 py-2">{value}</div>
    </div>
  );
}
