import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import AppShell from '@/components/layout/AppShell'
import {
  listLetterTemplates, createLetterTemplate, scanPlaceholders, activateLetterTemplate,
  deleteLetterTemplate, getBranding, uploadLogo, uploadSignature,
  LETTER_TYPES, LETTER_TYPE_LABELS, RECOGNIZED_PLACEHOLDERS,
  type LetterTemplate, type Block, type Run, type LetterType, type PlaceholderScanResult,
} from '@/lib/letterTemplates'
import { getErrorMessage } from '@/lib/errors'

function emptyRun(): Run {
  return { text: '' }
}

export default function LetterTemplatesPage() {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<LetterType | null>(null)
  const [showBranding, setShowBranding] = useState(false)

  const { data: templates, isLoading } = useQuery({
    queryKey: ['letter-templates'],
    queryFn: listLetterTemplates,
  })

  const activateMutation = useMutation({
    mutationFn: activateLetterTemplate,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['letter-templates'] }),
  })

  const deleteMutation = useMutation({
    mutationFn: deleteLetterTemplate,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['letter-templates'] }),
  })

  const templatesByType = new Map<string, LetterTemplate[]>()
  for (const t of templates ?? []) {
    const list = templatesByType.get(t.letter_type) ?? []
    list.push(t)
    templatesByType.set(t.letter_type, list)
  }

  return (
    <AppShell>
      <div className="p-8 max-w-5xl mx-auto">
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white">Letter Templates</h1>
            <p className="text-gray-500 text-sm mt-1">
              Compose your letters once — placeholders get filled in automatically per employee.
            </p>
          </div>
          <button
            onClick={() => setShowBranding(true)}
            className="px-4 py-2 rounded-lg text-sm font-medium text-gray-300 bg-gray-800
                       hover:bg-gray-700 transition-colors"
          >
            Logo & Signature
          </button>
        </div>

        {isLoading && <div className="text-gray-500 text-sm py-10 text-center">Loading…</div>}

        <div className="grid grid-cols-3 gap-3">
          {LETTER_TYPES.map((type) => {
            const existing = templatesByType.get(type) ?? []
            const active = existing.find((t) => t.is_active)
            return (
              <div
                key={type}
                onClick={() => setEditing(type)}
                className="bg-gray-900 border border-gray-800 hover:border-purple-500/50 rounded-2xl
                           p-5 text-left transition-colors cursor-pointer relative group"
              >
                <div className="text-white font-medium mb-1">{LETTER_TYPE_LABELS[type]}</div>
                {active ? (
                  <div className="text-green-400 text-xs">✓ Configured (v{active.version})</div>
                ) : (
                  <div className="text-gray-600 text-xs">Not set up yet</div>
                )}
                {active && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      if (confirm(`Delete the "${LETTER_TYPE_LABELS[type]}" template? Letters won't be generatable for this type until a new one is created.`)) {
                        deleteMutation.mutate(active.id)
                      }
                    }}
                    className="absolute top-3 right-3 text-gray-600 hover:text-red-400 text-xs
                               opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Delete this template"
                  >
                    ✕
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {editing && (
        <TemplateEditorModal
          letterType={editing}
          existing={templatesByType.get(editing) ?? []}
          onClose={() => setEditing(null)}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey: ['letter-templates'] })
            setEditing(null)
          }}
        />
      )}

      {showBranding && <BrandingModal onClose={() => setShowBranding(false)} />}
    </AppShell>
  )
}

// ---------------------------------------------------------------------- #
// Block editor
// ---------------------------------------------------------------------- #
// A real, complete Offer Letter — the same structure verified earlier
// against actual generated documents. One click fills this in so
// nothing needs to be built block-by-block from an empty editor.
function standardOfferLetter(): Block[] {
  // Matches the real iBridge Offer Letter exactly, including the
  // document-verification list and confidentiality/transfer clauses —
  // built directly from the uploaded real template, not paraphrased.
  // Title, right-aligned date, and justified body paragraphs all match
  // the real document's own formatting, verified against its actual
  // XML (not just its visible text).
  return [
    { type: 'heading', runs: [{ text: 'OFFER LETTER' }] },
    { type: 'spacer' },
    { type: 'paragraph', align: 'right', runs: [{ text: '{{today_date}}' }] },
    { type: 'spacer' },
    { type: 'paragraph', runs: [{ text: 'Dear ' }, { text: '{{employee_name}}', bold: true }, { text: ',' }] },
    { type: 'spacer' },
    { type: 'paragraph', runs: [{ text: 'Hearty Congratulations!' }] },
    { type: 'spacer' },
    { type: 'paragraph', runs: [
      { text: 'It gives us great pleasure to extend an offer of employment to join ' },
      { text: 'iBridge Techsoft Pvt Ltd,', bold: true },
      { text: ' herein Designated as ' }, { text: '{{designation}}', bold: true },
      { text: ' at ' }, { text: '{{client}}', bold: true }, { text: ' (' }, { text: '{{location}}' }, { text: ').' },
    ] },
    { type: 'spacer' },
    { type: 'paragraph', runs: [
      { text: 'Your date of commencement of Employment will be on ' }, { text: '{{doj}}', bold: true },
      { text: ' and your employment conditions are as follows:' },
    ] },
    { type: 'spacer' },
    { type: 'paragraph', align: 'justify', runs: [
      { text: '1. Salary: Your annual CTC will be Rs. ' }, { text: '{{current_ctc}}', bold: true },
      { text: '/- (' }, { text: '{{current_ctc_in_words}}' },
      { text: '). A detailed appointment letter will be given at the time of joining.' },
    ] },
    { type: 'paragraph', runs: [
      { text: '2. This offer is conditional upon receipt of the below listed documents no later than the day your employment commences with the company.' },
    ] },
    { type: 'paragraph', runs: [{ text: '3. Date of joining is subject to BGV clearance only.' }] },
    { type: 'spacer' },
    { type: 'paragraph', align: 'justify', runs: [{ text: 'Please note that you must present the below documents for verification purposes:' }] },
    { type: 'bulletList', items: [
      { runs: [{ text: 'Hiring letter and Appointment letter.' }] },
      { runs: [{ text: 'Permanent Account Number (PAN) card or copy of PAN application & Aadhar Card Copy.' }] },
      { runs: [{ text: 'Relieving certificate from your former employer' }] },
      { runs: [{ text: 'Copies of academic and professional certificates' }] },
      { runs: [{ text: 'One recent passport sized photograph' }] },
      { runs: [{ text: 'Last 3 pay slip & Form16.' }] },
    ] },
    { type: 'spacer' },
    { type: 'paragraph', runs: [
      { text: 'Failure to accept the offer on agreed timeline with the required documentation, as listed above, will result in an automatic withdrawal of this offer and employment cannot commence unless changes to stated timeline are specifically approved by the undersigned.' },
    ] },
    { type: 'spacer' },
    { type: 'paragraph', runs: [
      { text: 'Your individual compensation package is confidential between you and the company and should not be disclosed to any person or entity without the prior written consent of ' },
      { text: 'iBridge', bold: true }, { text: '.' },
    ] },
    { type: 'spacer' },
    { type: 'paragraph', runs: [
      { text: 'iBridge', bold: true },
      { text: ' has the right to transfer your employment or services to any client, affiliate, group entity or any lawful transferee/assignee of ' },
      { text: 'iBridge', bold: true },
      { text: ' business, subject to compliance with applicable laws. Please notify ' },
      { text: 'iBridge', bold: true },
      { text: ' of your acceptance of the terms and conditions of this offer of employment as stated in the offer letter via email to hr@ibridgetechsoft.com.' },
    ] },
    { type: 'spacer' },
    { type: 'paragraph', runs: [
      { text: 'iBridge', bold: true },
      { text: ' is a rapidly growing organization and we seek to attract and retain the most talented professionals whose contributions will make a significant difference in our success. We look forward to working with you.' },
    ] },
    { type: 'spacer' },
    { type: 'paragraph', runs: [{ text: 'Yours sincerely,' }] },
    { type: 'signature' },
    { type: 'paragraph', runs: [{ text: 'HR – Manager' }] },
    { type: 'paragraph', runs: [{ text: 'For and on behalf of ' }, { text: 'iBridge Techsoft Pvt Ltd', bold: true }] },
    { type: 'spacer' },
    { type: 'paragraph', runs: [{ text: 'Schedule A - Salary & Allowances', bold: true }] },
    { type: 'ctcTable' },
    { type: 'spacer' },
    { type: 'paragraph', runs: [
      { text: 'I accept the offer of employment at iBridge Techsoft Pvt Ltd on the terms and conditions described above.' },
    ] },
    { type: 'paragraph', runs: [{ text: 'Signature:                    Date:' }] },
  ]
}

function standardAppointmentLetter(): Block[] {
  // Matches the real iBridge Appointment Letter — all 13 clauses plus
  // the non-solicitation and IP/laptop-policy sections, built from the
  // uploaded real template. Nested sub-clauses (a, b, c and further
  // bullets under clause 9) don't have a true nested-list equivalent in
  // this block editor, so they're represented as clearly-numbered/
  // lettered paragraphs instead — full legal content preserved, exact
  // Word-style indentation is the one thing not reproduced pixel-for-pixel.
  return [
    { type: 'heading', runs: [{ text: 'Appointment Letter' }] },
    { type: 'paragraph', runs: [{ text: 'Ref. No. ITPL/HR/AL {{ref_no}}' }] },
    { type: 'paragraph', runs: [{ text: 'Date: ' }, { text: '{{today_date}}', bold: true }] },
    { type: 'spacer' },
    { type: 'paragraph', runs: [{ text: 'Dear ' }, { text: '{{employee_name}}', bold: true }, { text: ',' }] },
    { type: 'spacer' },
    { type: 'paragraph', runs: [
      { text: 'This is reference to our offer dated ' }, { text: '{{offer_ref_date}}', bold: true },
      { text: '. We are pleased to offer you employment at ' },
      { text: 'iBridge Techsoft Private Limited', bold: true },
      { text: ' with the following terms and conditions:' },
    ] },
    { type: 'spacer' },
    { type: 'paragraph', runs: [
      { text: '1. Designation: ', bold: true }, { text: 'You will be designated as ' },
      { text: '{{designation}}', bold: true }, { text: '.' },
    ] },
    { type: 'paragraph', runs: [{ text: 'Date of Joining: ' }, { text: '{{doj}}', bold: true }] },
    { type: 'spacer' },
    { type: 'paragraph', runs: [
      { text: '2. Compensation: ', bold: true },
      { text: 'Your annual cost to the company (CTC) is Rs. ' }, { text: '{{current_ctc}}', bold: true },
      { text: '/- (' }, { text: '{{current_ctc_in_words}}' },
      { text: '). Compensation offered to you is strictly confidential and should not be discussed with anyone. The details of the salary are provided in the annexure to this letter. All components of your salary are subject to change as per Company policy.' },
    ] },
    { type: 'paragraph', runs: [
      { text: '3. Reporting for Work: ', bold: true },
      { text: 'You will report to the designated Managers for all functional and administrative purposes.' },
    ] },
    { type: 'paragraph', runs: [
      { text: '4. Place of Work: ', bold: true }, { text: 'You will initially report to work at ' },
      { text: '{{location}}', bold: true },
      { text: '. However, you are required to travel/relocate to any place in India or abroad or to any associate or client premises or a subsidiary, whether existing or acquired later, at the sole discretion of the management as per the demands of the Company or its clients. You shall, however, have no right to demand such travel or transfer, for any reason whatsoever. If you are deputed to any Associate/Subsidiary/Group company outside India or at any client location by the Company, it shall be treated as you having bound to serve the company for the deputation period, and for the stipulated period thereafter, if any, and the same shall be treated as the contract period vis-à-vis this contract of service.' },
    ] },
    { type: 'paragraph', runs: [
      { text: '5. Attendance, Leave and Holidays: ', bold: true },
      { text: 'Your working hours have to adhere to the client\'s working hours (which will be communicated in advance) as per project requirements. However, in view of work commitment and delivery schedule, your respective managers may advise you to work during non-business hours or stretch your working hours at their sole discretion based on business needs.' },
    ] },
    { type: 'paragraph', runs: [
      { text: 'As per the Leave Policy 12 days of leave in a calendar year which includes Casual Leaves & Sick Leave, calculated on pro-rata basis from the time you are going to complete one month which is 30 days from the date of your joining. ' },
      { text: 'Leave eligibility will commence post completion of first month. Prior permission is required from your reporting manager to avail leaves.', bold: true },
      { text: ' Your iBridge HR should be aware of your applied and approved leaves too as and when required. In case of medical & other emergency your concerned/reporting manager should be well informed along with iBridge HR. Being absent without any information for more than 3 days will be considered as absconding, the person found doing this iBridge will not be held responsible nor will he be liable to pay for the duration.' },
    ] },
    { type: 'paragraph', runs: [
      { text: 'Apart from your leaves you need to follow the Holiday calendar of the respective Client which we will share at the time of joining.' },
    ] },
    { type: 'paragraph', runs: [
      { text: '6. GMC (Insurance): ', bold: true },
      { text: 'A Benefit which Covers Employee, Spouse and 2 Children with 2 Lakhs (Floater) Sum Insured for the Family. Also, glad to inform you that iBridge provides 3 Lakhs GPA (Personal Accident Policy) to Employee which is facilitated by iBridge as a financial protection to your family.' },
    ] },
    { type: 'paragraph', runs: [
      { text: '7. Full time employment & conflict of Interest: ', bold: true },
      { text: 'During your employment with the company, you shall devote your time and attention to the company\'s business entrusted to you and you shall not engage yourself with any "for profit" Organization directly or indirectly in any business or service, without prior written permission of the company.' },
    ] },
    { type: 'paragraph', runs: [
      { text: '8. Confidentiality Agreement: ', bold: true },
      { text: 'You are required to sign a separate confidentiality and NDA along with this appointment letter.' },
    ] },
    { type: 'spacer' },
    { type: 'paragraph', runs: [{ text: 'Non-solicitation and non-compete:', bold: true }] },
    { type: 'paragraph', runs: [
      { text: 'Staff: ', bold: true },
      { text: 'You agree that during your employment and for a period of 2 years after your employment with the company ends, whatever the reason of such termination, you will not, directly or indirectly, aid, solicit or induce any employee, contractors, directors or officers of the company to leave the company for employment or other relationship with any entity that is involved in any aspect of the business of the company.' },
    ] },
    { type: 'paragraph', runs: [
      { text: 'Customer / Prospects: ', bold: true },
      { text: 'You agree that during your employment and for a period of 2 years after your employment with the company ends, whatever the reason of such termination, you will not, directly or indirectly:' },
    ] },
    { type: 'bulletList', items: [
      { runs: [{ text: 'Solicit any customer, clients, prospect, partner, and vendor of the company.' }] },
      { runs: [{ text: 'Join any customer, clients, prospect, partner, or vendor as an employee, consultant, advisor, or contractor.' }] },
      { runs: [{ text: 'Induce any customer, clients, prospect, partner, and vendor to stop working with the company.' }] },
      { runs: [{ text: 'Compete with Company for any business with Company\'s customer, clients, partner, and Vendor.' }] },
    ] },
    { type: 'spacer' },
    { type: 'paragraph', runs: [
      { text: '9. Protection of Intellectual Property Rights: ', bold: true },
      { text: 'All works such as development, modifications, improvisations in the form of programs, policies, studies, reports, manuals, etc. carried out for the company with your involvement shall be the property of the company. Copyrights or intellectual property rights of any other kind, for all such work, including those that are generated and created during the course of doing such work, shall remain with the company and you will not have any claims on the same.' },
    ] },
    { type: 'paragraph', runs: [
      { text: 'a. Ownership: ', bold: true },
      { text: 'The laptop, accessories, software and operating system issued to you shall remain the property of Ibridge and are provided on a loan basis. These items can and may be recalled at any time.' },
    ] },
    { type: 'paragraph', runs: [{ text: 'b. Responsibilities: The employee shall adhere to the following:', bold: true }] },
    { type: 'bulletList', items: [
      { runs: [{ text: 'Additional software should not be installed nor hardware modifications made without authorization from Ibridge.' }] },
      { runs: [{ text: 'The laptop should be used for official purposes only.' }] },
      { runs: [{ text: 'Protect damaging of computers, computer systems or computer networks.' }] },
      { runs: [{ text: 'Shall not violate Copyright laws.' }] },
      { runs: [{ text: 'Shall not use other people\'s login details or trespass in other\'s folders, work or files.' }] },
      { runs: [{ text: 'Shall not allow any other person to use the laptop other than an Ibridge authorized person.' }] },
      { runs: [{ text: 'Shall not disclose, copy, or share data except unless you have written communication from your supervisor.' }] },
      { runs: [{ text: 'If there is any loss/damage to the laptop, your immediate supervisor must be immediately informed.' }] },
      { runs: [{ text: 'The employee shall be responsible for the cost of repair/replacement of the laptop, in the event of a breach of any condition of this Agreement.' }] },
      { runs: [{ text: 'The employee shall ensure the protection of the business, goodwill, confidential information, its trade secret and/or other proprietary information about Ibridge and its clients.' }] },
      { runs: [{ text: 'The Employee shall return to the Company by close of business no later than her/his separation date any and all Company property in her/his possession, including but not limited to Company cell phone, PDA, keys, building passes, credit cards, documents, files, and software, and all written information pertaining to iBridge\'s business.' }] },
    ] },
    { type: 'paragraph', runs: [
      { text: 'c. Monitoring: ', bold: true },
      { text: 'iBridge reserves the right to monitor all usage carried out by employees to ensure proper working and appropriate use by employees, the security of data, and to retrieve the contents of any employee communication in these systems. Management may access user files, including archived material of present and former employees without the user\'s consent for any purpose related to maintaining the integrity of the network, or the rights of iBridge and its clients or other users or any other reasonable purpose.' },
    ] },
    { type: 'paragraph', runs: [
      { text: 'd. Archiving and Backup of Data: ', bold: true },
      { text: 'Employees are responsible for keeping up-to-date back-up copies of their documents and data contained on the laptop.' },
    ] },
    { type: 'paragraph', runs: [
      { text: 'e. Non-Disparagement: ', bold: true },
      { text: 'The Employee agrees not to engage in any form of conduct, nor make any statements or representations that disparage or otherwise impair the reputation, goodwill or interests of the Company, its agents, officers, directors or employees.' },
    ] },
    { type: 'spacer' },
    { type: 'paragraph', runs: [
      { text: '10. Professional Ethics: ', bold: true },
      { text: 'You shall not conduct yourself in any manner, amounting to breach of confidence reposed to you or inconsistent with the company\'s code of conduct and position of responsibility occupied by you. You are expected to deal with the company\'s money, material, documents and any other property with utmost honesty and professional ethics.' },
    ] },
    { type: 'paragraph', runs: [
      { text: '11. Retirement / Termination Clause: ', bold: true },
      { text: 'Either party may terminate this agreement by giving {{notice_period}} notice, in writing without assigning any reason. The company reserves the right to pay or recover from you the amount of the notice period salary in lieu of the notice period. However, in case of resignation you will reach out to iBridge HR and further the Client will decide about your release date from the project. The day you have been released from project that will be treated as your last working day. The company may, at its sole discretion, relieve you from such date as it may deem fit even before the expiration of the notice period, without incurring any liability to pay you compensation for the unexpired period of the notice period.' },
    ] },
    { type: 'paragraph', runs: [
      { text: 'In case if your project assignment or contract with the Client is completed, Company will market your profile for other project assignments. You acknowledge that the Company is relieved from running any payroll, salary or compensation for the duration your services are not billable with the Client. At the time of leaving, you will ensure that all your on-going activities including all projects are successfully completed, to the satisfaction of your manager.' },
    ] },
    { type: 'paragraph', runs: [
      { text: 'You must also ensure that you have handed over all company property issued to you (if any) including your identity card, Access card etc. and it is handed over to the Manager (Administration). Your final dues settlement with the company will be subject to a \'No-Dues\' certificate and a \'satisfactory-completion-and-handing-over-project\' certificate from your manager. You will automatically retire in the normal course, from the services of the company on attaining the age of superannuation, on the day following your 60th birthday.' },
    ] },
    { type: 'paragraph', runs: [
      { text: '12. Abandonment: ', bold: true },
      { text: 'Absence from work for a continuous period of five days, including absence upon leave though applied, but not granted or overstay for a period of five days after expiry of sanctioned leave, without written permission, shall make you lose your job, and your services shall automatically cease without any notice or intimation.' },
    ] },
    { type: 'paragraph', runs: [
      { text: 'In the event of breach of any of the terms and conditions of this letter, the company shall be entitled to initiate appropriate legal action against you at your cost and risk and you shall be liable to pay liquidated damages to be quantified by the company at the relevant point of time having regard to the exigencies of work of the company.' },
    ] },
    { type: 'paragraph', runs: [
      { text: '13. Company Policies: ', bold: true },
      { text: 'You agree and accept that as part of your job responsibilities, you will follow the guidelines, standards, rules, policies and practices of the company prevailing from time to time. You agree that the Company may change any of the company\'s guidelines, standards, rules, policies and practices from time to time, and that such change will apply to your job responsibilities and be binding on you after the effective date of the change.' },
    ] },
    { type: 'spacer' },
    { type: 'paragraph', runs: [
      { text: 'For the avoidance of doubt, nothing in this agreement shall affect or be construed to prejudice or override any of the Company\'s obligations imposed by law, and the terms of this Appointment Letter shall be read subject to such legal obligations.' },
    ] },
    { type: 'paragraph', runs: [
      { text: 'You warrant that you are under no contractual duty or obligation arising from any other contracts you may have entered into which restrains you for whatever reason from being employed by or working for the company.' },
    ] },
    { type: 'paragraph', runs: [
      { text: 'Kindly note that any action on your part contrary to any of the above-mentioned clauses shall render you liable to termination with immediate effect without notice or payment of an amount in lieu of a notice period.' },
    ] },
    { type: 'paragraph', runs: [
      { text: 'Your appointment is based on the information provided by you in your resume. If any information given by you to the company proves to be false or if you are found to have suppressed or concealed any material information, in such an event, your services will be liable for termination with immediate effect as above.' },
    ] },
    { type: 'paragraph', runs: [
      { text: 'Your employment in the services of the company shall always be subject to your being found and remaining mentally and physically fit.' },
    ] },
    { type: 'spacer' },
    { type: 'paragraph', runs: [
      { text: 'Please sign and return a copy of this appointment letter, along with the attached annexure, as a record of your having read and accepted the terms of this offer and appointment.' },
    ] },
    { type: 'spacer' },
    { type: 'paragraph', runs: [{ text: 'We welcome you to the iBridge Family.' }] },
    { type: 'spacer' },
    { type: 'signature' },
    { type: 'paragraph', runs: [{ text: 'HR – Manager' }] },
    { type: 'paragraph', runs: [{ text: 'For and on behalf of ' }, { text: 'iBridge Techsoft Pvt Ltd', bold: true }] },
    { type: 'spacer' },
    { type: 'paragraph', runs: [{ text: 'Annexure A', bold: true, underline: true }] },
    { type: 'ctcTable' },
    { type: 'bulletList', items: [
      { runs: [{ text: 'Professional Tax will be deducted as per State Government laws.' }] },
      { runs: [{ text: 'Employee and Employer Provident Fund will be deducted from CTC.' }] },
      { runs: [{ text: 'ESIC will be deducted if applicable.' }] },
      { runs: [{ text: 'Income Tax will be deducted as per investment declarations and proofs submission.' }] },
    ] },
  ]
}

function standardHikeLetter(): Block[] {
  // Matches the real iBridge Salary Appraisal letter exactly.
  return [
    { type: 'paragraph', runs: [{ text: '{{today_date}}' }] },
    { type: 'paragraph', runs: [{ text: 'Hyderabad' }] },
    { type: 'spacer' },
    { type: 'paragraph', runs: [{ text: 'Subject: Salary Appraisal', bold: true }] },
    { type: 'spacer' },
    { type: 'paragraph', runs: [{ text: 'Dear ' }, { text: '{{employee_name}}', bold: true }, { text: ',' }] },
    { type: 'spacer' },
    { type: 'paragraph', runs: [
      { text: 'After review of your performance and compensation, ' }, { text: 'iBridge\'s', bold: true },
      { text: ' management is pleased to increase your salary with effect from ' },
      { text: '{{effective_date}}', bold: true }, { text: '.' },
    ] },
    { type: 'spacer' },
    { type: 'paragraph', runs: [
      { text: 'With this revision your CTC is Rs: ' }, { text: '{{revised_ctc}}', bold: true },
      { text: '/- (' }, { text: '{{revised_ctc_in_words}}' },
      { text: '). This revision is aimed at recognizing and rewarding your performance.' },
    ] },
    { type: 'spacer' },
    { type: 'paragraph', runs: [
      { text: 'We are confident that you shall continue to work with dedication, loyalty and enthusiasm so as to help the organization achieve greater heights.' },
    ] },
    { type: 'spacer' },
    { type: 'paragraph', runs: [{ text: 'All other terms & conditions of your employment remain the same.' }] },
    { type: 'spacer' },
    { type: 'paragraph', runs: [{ text: 'Yours sincerely,' }] },
    { type: 'signature' },
    { type: 'paragraph', runs: [{ text: 'HR – Manager' }] },
    { type: 'paragraph', runs: [{ text: 'For and on behalf of ' }, { text: 'iBridge Techsoft Pvt Ltd', bold: true }] },
  ]
}

function standardRelievingLetter(): Block[] {
  // Matches the real iBridge Relieving & Experience Letter. The
  // uploaded template had a garbled block of repeated "SAP ABAP
  // Consultant" lines right after the designation placeholder — a
  // leftover copy-paste artifact in the source Word file, not
  // intentional content — so that repetition isn't reproduced here.
  return [
    { type: 'paragraph', align: 'right', runs: [{ text: 'Date: ' }, { text: '{{today_date}}', bold: true }] },
    { type: 'spacer' },
    { type: 'paragraph', align: 'justify', runs: [{ text: 'Relieving & Experience Letter', bold: true, underline: true }] },
    { type: 'spacer' },
    { type: 'paragraph', align: 'justify', runs: [{ text: 'TO WHOMSOEVER IT MAY CONCERN', bold: true }] },
    { type: 'spacer' },
    { type: 'paragraph', align: 'justify', runs: [
      { text: 'This is to certify that ' }, { text: '{{employee_name}}', bold: true },
      { text: ', EMP ID: ' }, { text: '{{employee_code}}', bold: true },
      { text: ' has worked with our organization, ' }, { text: 'iBridge Techsoft Pvt Ltd', bold: true },
      { text: ' for the period ' }, { text: '{{period_from}}', bold: true }, { text: ' to ' },
      { text: '{{period_to}}', bold: true }, { text: ' as ' }, { text: '{{designation}}', bold: true }, { text: '.' },
    ] },
    { type: 'spacer' },
    { type: 'paragraph', runs: [
      { text: 'We take this opportunity to thank you for your services and wish you every success in your future endeavours.' },
    ] },
    { type: 'spacer' },
    { type: 'paragraph', runs: [{ text: 'Yours sincerely,' }] },
    { type: 'signature' },
    { type: 'paragraph', runs: [{ text: 'HR – Manager' }] },
    { type: 'paragraph', runs: [{ text: 'For and on behalf of ' }, { text: 'iBridge Techsoft Pvt Ltd', bold: true }] },
  ]
}


const QUICK_START_BY_TYPE: Partial<Record<LetterType, () => Block[]>> = {
  offer: standardOfferLetter,
  appointment: standardAppointmentLetter,
  hike: standardHikeLetter,
  relieving: standardRelievingLetter,
}

function TemplateEditorModal({
  letterType, existing, onClose, onSaved,
}: {
  letterType: LetterType
  existing: LetterTemplate[]
  onClose: () => void
  onSaved: () => void
}) {
  const activeTemplate = existing.find((t) => t.is_active)
  const [name, setName] = useState(activeTemplate?.name ?? LETTER_TYPE_LABELS[letterType])
  const [blocks, setBlocks] = useState<Block[]>(activeTemplate?.blocks ?? [
    { type: 'paragraph', runs: [{ text: 'Dear ' }, { text: '{{employee_name}}', bold: true }, { text: ',' }] },
  ])
  const [reviewResult, setReviewResult] = useState<PlaceholderScanResult | null>(null)
  const [mandatoryFlags, setMandatoryFlags] = useState<Record<string, boolean>>({})
  const [customDefaults, setCustomDefaults] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)

  const saveMutation = useMutation({
    mutationFn: () => {
      const mandatory = Object.entries(mandatoryFlags).filter(([, v]) => v).map(([k]) => k)
      return createLetterTemplate(letterType, name, blocks, mandatory, customDefaults)
    },
    onSuccess: onSaved,
    onError: (err: any) => setError(getErrorMessage(err, 'Could not save.')),
  })

  function addBlock(type: Block['type']) {
    const newBlock: Block =
      type === 'paragraph' || type === 'heading' ? { type, runs: [emptyRun()] } :
      type === 'bulletList' || type === 'numberedList' ? { type, items: [{ runs: [emptyRun()] }] } :
      { type } as Block
    setBlocks((prev) => [...prev, newBlock])
  }

  function removeBlock(index: number) {
    setBlocks((prev) => prev.filter((_, i) => i !== index))
  }

  function moveBlock(index: number, direction: -1 | 1) {
    setBlocks((prev) => {
      const next = [...prev]
      const target = index + direction
      if (target < 0 || target >= next.length) return prev
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  function updateRuns(blockIndex: number, runs: Run[]) {
    setBlocks((prev) => prev.map((b, i) => {
      if (i !== blockIndex) return b
      if (b.type === 'paragraph' || b.type === 'heading') return { ...b, runs }
      return b
    }))
  }

  async function handleReview() {
    try {
      const result = await scanPlaceholders(blocks)
      setReviewResult(result)
      const initialFlags: Record<string, boolean> = {}
      for (const p of result.custom) initialFlags[p] = false
      setMandatoryFlags(initialFlags)
      setError(null)
    } catch (err: any) {
      setError(getErrorMessage(err, 'Could not scan placeholders.'))
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
      <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-3xl max-h-[90vh]
                      overflow-y-auto p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-white text-lg font-bold">{LETTER_TYPE_LABELS[letterType]}</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white">✕</button>
        </div>

        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm
                     text-white mb-4 focus:outline-none focus:border-purple-500"
        />

        {error && (
          <div className="bg-red-900/30 border border-red-800 rounded-lg px-4 py-2 text-red-300 text-sm mb-4">
            {error}
          </div>
        )}

        {QUICK_START_BY_TYPE[letterType] && (
          <button
            onClick={() => {
              if (!activeTemplate || confirm('This will replace the content currently shown in the editor below (not yet saved). Continue?')) {
                setBlocks(QUICK_START_BY_TYPE[letterType]!())
              }
            }}
            className="w-full py-2.5 rounded-lg text-sm font-semibold text-white mb-4
                       bg-gradient-to-r from-green-500 to-emerald-500 hover:opacity-90 transition-opacity"
          >
            ⚡ Use Standard {LETTER_TYPE_LABELS[letterType]}
          </button>
        )}

        {/* Block toolbar */}
        <div className="flex flex-wrap gap-2 mb-4">
          {(['heading', 'paragraph', 'bulletList', 'numberedList', 'ctcTable', 'signature', 'spacer'] as const).map((t) => (
            <button
              key={t}
              onClick={() => addBlock(t)}
              className="px-2.5 py-1 rounded-md text-xs bg-gray-800 text-gray-300 hover:bg-gray-700"
            >
              + {t}
            </button>
          ))}
        </div>

        {/* Block list */}
        <div className="space-y-2 mb-5">
          {blocks.map((block, i) => (
            <BlockEditor
              key={i}
              block={block}
              onChange={(runs) => updateRuns(i, runs)}
              onRemove={() => removeBlock(i)}
              onMoveUp={() => moveBlock(i, -1)}
              onMoveDown={() => moveBlock(i, 1)}
            />
          ))}
        </div>

        <button
          onClick={handleReview}
          className="w-full py-2 rounded-lg text-sm font-medium text-white bg-blue-600
                     hover:bg-blue-500 transition-colors mb-4"
        >
          Review Placeholders
        </button>

        {reviewResult && (
          <div className="bg-gray-800/60 border border-gray-700 rounded-lg p-4 mb-4">
            {!!reviewResult.recognized.length && (
              <div className="mb-3">
                <div className="text-gray-400 text-xs mb-1">Recognized (auto-filled)</div>
                <div className="flex flex-wrap gap-1">
                  {reviewResult.recognized.map((p) => (
                    <span key={p} className="px-2 py-0.5 rounded bg-green-500/20 text-green-300 text-xs">
                      {'{{' + p + '}}'}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {!!reviewResult.custom.length && (
              <div>
                <div className="text-amber-400 text-xs mb-2">
                  Custom placeholders — mark mandatory or provide a default
                </div>
                {reviewResult.custom.map((p) => (
                  <div key={p} className="flex items-center gap-2 mb-2">
                    <span className="text-white text-xs font-mono w-40">{'{{' + p + '}}'}</span>
                    <label className="flex items-center gap-1 text-xs text-gray-400">
                      <input
                        type="checkbox"
                        checked={mandatoryFlags[p] ?? false}
                        onChange={(e) => setMandatoryFlags((prev) => ({ ...prev, [p]: e.target.checked }))}
                      />
                      Mandatory
                    </label>
                    {!mandatoryFlags[p] && (
                      <input
                        value={customDefaults[p] ?? ''}
                        onChange={(e) => setCustomDefaults((prev) => ({ ...prev, [p]: e.target.value }))}
                        placeholder="Default value"
                        className="flex-1 bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-white"
                      />
                    )}
                  </div>
                ))}
              </div>
            )}
            {!reviewResult.recognized.length && !reviewResult.custom.length && (
              <div className="text-gray-500 text-xs">No placeholders used in this letter.</div>
            )}
          </div>
        )}

        <div className="flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-gray-400 hover:text-white">
            Cancel
          </button>
          <button
            onClick={() => saveMutation.mutate()}
            disabled={!name || saveMutation.isPending}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-white
                       bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500
                       hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {saveMutation.isPending ? 'Saving…' : 'Save Template'}
          </button>
        </div>
      </div>
    </div>
  )
}

function BlockEditor({
  block, onChange, onRemove, onMoveUp, onMoveDown,
}: {
  block: Block
  onChange: (runs: Run[]) => void
  onRemove: () => void
  onMoveUp: () => void
  onMoveDown: () => void
}) {
  const controls = (
    <div className="flex items-center gap-1">
      <button onClick={onMoveUp} className="text-gray-500 hover:text-white text-xs px-1">↑</button>
      <button onClick={onMoveDown} className="text-gray-500 hover:text-white text-xs px-1">↓</button>
      <button onClick={onRemove} className="text-red-400 hover:text-red-300 text-xs px-1">✕</button>
    </div>
  )

  if (block.type === 'ctcTable') {
    return (
      <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg px-3 py-2
                      flex items-center justify-between">
        <span className="text-purple-300 text-sm">📊 CTC Breakup Table</span>
        {controls}
      </div>
    )
  }

  if (block.type === 'signature') {
    return (
      <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg px-3 py-2
                      flex items-center justify-between">
        <span className="text-blue-300 text-sm">✍️ Authorized Signature</span>
        {controls}
      </div>
    )
  }

  if (block.type === 'spacer') {
    return (
      <div className="bg-gray-800/40 border border-gray-700 border-dashed rounded-lg px-3 py-2
                      flex items-center justify-between">
        <span className="text-gray-500 text-sm">— blank line —</span>
        {controls}
      </div>
    )
  }

  if (block.type === 'paragraph' || block.type === 'heading') {
    return (
      <div className="bg-gray-800/60 border border-gray-700 rounded-lg p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-gray-500 text-xs uppercase">{block.type}</span>
          {controls}
        </div>
        <RunEditor runs={block.runs} onChange={onChange} />
      </div>
    )
  }

  // bulletList / numberedList — simplified to one run per item for this milestone
  return (
    <div className="bg-gray-800/60 border border-gray-700 rounded-lg p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-gray-500 text-xs uppercase">{block.type}</span>
        {controls}
      </div>
      {block.items.map((item, i) => (
        <input
          key={i}
          value={item.runs[0]?.text ?? ''}
          onChange={(e) => {
            const newItems = [...block.items]
            newItems[i] = { runs: [{ text: e.target.value }] }
            onChange(newItems as any)
          }}
          className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-white mb-1"
        />
      ))}
    </div>
  )
}

function RunEditor({ runs, onChange }: { runs: Run[]; onChange: (runs: Run[]) => void }) {
  function updateRun(index: number, patch: Partial<Run>) {
    onChange(runs.map((r, i) => (i === index ? { ...r, ...patch } : r)))
  }

  function addRun() {
    onChange([...runs, emptyRun()])
  }

  function insertPlaceholder(placeholder: string) {
    onChange([...runs, { text: `{{${placeholder}}}` }])
  }

  function removeRun(index: number) {
    onChange(runs.filter((_, i) => i !== index))
  }

  return (
    <div>
      {runs.map((run, i) => (
        <div key={i} className="flex items-center gap-2 mb-1.5">
          <input
            value={run.text}
            onChange={(e) => updateRun(i, { text: e.target.value })}
            className="flex-1 bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-white"
          />
          <label className="flex items-center gap-1 text-xs text-gray-400 whitespace-nowrap">
            <input
              type="checkbox"
              checked={run.bold ?? false}
              onChange={(e) => updateRun(i, { bold: e.target.checked })}
            />
            Bold
          </label>
          <button onClick={() => removeRun(i)} className="text-red-400 hover:text-red-300 text-xs">✕</button>
        </div>
      ))}
      <div className="flex items-center gap-2 mt-2">
        <button onClick={addRun} className="text-xs text-purple-400 hover:text-purple-300">
          + Add Text
        </button>
        <select
          onChange={(e) => { if (e.target.value) { insertPlaceholder(e.target.value); e.target.value = '' } }}
          className="bg-gray-900 border border-gray-700 rounded px-2 py-0.5 text-xs text-gray-400"
        >
          <option value="">+ Insert Placeholder…</option>
          {RECOGNIZED_PLACEHOLDERS.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------- #
// Branding modal
// ---------------------------------------------------------------------- #
function BrandingModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient()
  const { data: branding } = useQuery({ queryKey: ['branding'], queryFn: getBranding })

  const logoMutation = useMutation({
    mutationFn: uploadLogo,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['branding'] }),
  })
  const signatureMutation = useMutation({
    mutationFn: uploadSignature,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['branding'] }),
  })

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
      <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-white text-lg font-bold">Logo & Signature</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white">✕</button>
        </div>

        <div className="mb-5">
          <div className="text-gray-400 text-sm mb-2">Company Logo</div>
          {branding?.logo_storage_path && (
            <div className="text-green-400 text-xs mb-2">✓ Logo uploaded</div>
          )}
          {logoMutation.isPending && (
            <div className="text-gray-400 text-xs mb-2">Uploading…</div>
          )}
          {logoMutation.isError && (
            <div className="text-red-400 text-xs mb-2">
              {getErrorMessage(logoMutation.error, 'Upload failed. Please try again.')}
            </div>
          )}
          <input
            type="file"
            accept="image/png,image/jpeg"
            disabled={logoMutation.isPending}
            onChange={(e) => e.target.files?.[0] && logoMutation.mutate(e.target.files[0])}
            className="text-xs text-gray-400"
          />
        </div>

        <div>
          <div className="text-gray-400 text-sm mb-2">Authorized Signature</div>
          {branding?.signature_storage_path && (
            <div className="text-green-400 text-xs mb-2">✓ Signature uploaded</div>
          )}
          {signatureMutation.isPending && (
            <div className="text-gray-400 text-xs mb-2">Uploading…</div>
          )}
          {signatureMutation.isError && (
            <div className="text-red-400 text-xs mb-2">
              {getErrorMessage(signatureMutation.error, 'Upload failed. Please try again.')}
            </div>
          )}
          <input
            type="file"
            accept="image/png,image/jpeg"
            disabled={signatureMutation.isPending}
            onChange={(e) => e.target.files?.[0] && signatureMutation.mutate(e.target.files[0])}
            className="text-xs text-gray-400"
          />
        </div>
      </div>
    </div>
  )
}
