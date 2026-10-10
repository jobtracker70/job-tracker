export const metadata = { title: 'Privacy Policy — Job Tracker' }

export default function PrivacyPage() {
  return (
    <main className="max-w-2xl mx-auto px-5 py-10 space-y-5 text-gray-200 leading-relaxed">
      <h1 className="text-2xl font-bold text-white">Privacy Policy</h1>
      <p className="text-gray-400 text-sm">Job Tracker, operated by Aayush Painting (KARSUN SERVICES PTY LTD), Australia.</p>

      <h2 className="text-lg font-semibold text-white pt-2">What this service is</h2>
      <p>
        Job Tracker is a private tool used by one painting business to record when its workers and subcontractors start and
        finish work at job sites, and to work out job costs. It is not a public service.
      </p>

      <h2 className="text-lg font-semibold text-white pt-2">What we collect</h2>
      <ul className="list-disc pl-5 space-y-1">
        <li>A worker&apos;s name and WhatsApp phone number, added by the business owner.</li>
        <li>The messages a worker sends to the business WhatsApp number (for example &quot;Sign in&quot;) and the job they choose.</li>
        <li>The time a worker signs in and out of each job.</li>
        <li>Supplier and subcontractor invoices the business receives, for job costing.</li>
      </ul>

      <h2 className="text-lg font-semibold text-white pt-2">How we use it</h2>
      <p>
        Only to track hours and costs for the business&apos;s jobs and to check subcontractor invoices against recorded hours.
        We do not sell this information, use it for advertising, or share it with anyone outside the business, other than the
        service providers needed to run the tool (WhatsApp/Meta for messaging, and our hosting and database providers).
      </p>

      <h2 className="text-lg font-semibold text-white pt-2">Who can see it</h2>
      <p>Only the business owner, through a password-protected website.</p>

      <h2 className="text-lg font-semibold text-white pt-2">Keeping and deleting data</h2>
      <p>
        Records are kept while they are needed for the business&apos;s accounts and job history. A worker can ask the business
        owner to correct or delete their personal information at any time.
      </p>
    </main>
  )
}
