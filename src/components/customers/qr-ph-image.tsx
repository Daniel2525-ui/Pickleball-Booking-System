/** A QR Ph code with its badge in the centre. */
export function QrPhImage({ src, size = 288 }: { src: string; size?: number }) {
  return (
    <div className="relative mx-auto w-fit rounded-lg bg-white p-2">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="QR Ph payment code" width={size} height={size} />
      <span aria-hidden="true" className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-md bg-white px-2 py-1 text-lg font-extrabold leading-none tracking-tight">
        <span className="text-[#0038A8]">QR</span><span className="text-[#CE1126]">Ph</span>
      </span>
    </div>
  );
}
