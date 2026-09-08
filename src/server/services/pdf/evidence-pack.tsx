import {
  Document, Page, Text, View, StyleSheet, renderToBuffer,
  type DocumentProps,
} from '@react-pdf/renderer';
import type { ReactElement } from 'react';

/**
 * The incident evidence pack.
 *
 * This is the artifact the product is sold on: the thing an HSE manager hands
 * an auditor, an insurer or a lawyer. It has to be self-contained and
 * unambiguous — everything known about one event, in the order an auditor
 * reads it, with the audit trail at the back so the record can be shown to be
 * complete rather than merely asserted to be.
 *
 * Rendered with @react-pdf/renderer rather than headless Chromium: it is pure
 * JavaScript, so it runs inside a serverless function without a 100 MB browser
 * binary and a cold start to match.
 */

const C = {
  ink: '#0f172a',
  body: '#334155',
  muted: '#64748b',
  rule: '#cbd5e1',
  brand: '#0f766e',
  alert: '#b91c1c',
  wash: '#f8fafc',
};

const s = StyleSheet.create({
  page: { paddingTop: 44, paddingBottom: 56, paddingHorizontal: 44, fontSize: 9.5, color: C.body, lineHeight: 1.5 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end',
            borderBottomWidth: 2, borderBottomColor: C.brand, paddingBottom: 6, marginBottom: 16 },
  brand: { fontSize: 12, fontFamily: 'Helvetica-Bold', color: C.brand },
  org: { fontSize: 8.5, color: C.muted },
  title: { fontSize: 17, fontFamily: 'Helvetica-Bold', color: C.ink, marginBottom: 3 },
  ref: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: C.brand, marginBottom: 10 },
  h2: { fontSize: 11, fontFamily: 'Helvetica-Bold', color: C.ink, marginTop: 16, marginBottom: 6,
        borderBottomWidth: 1, borderBottomColor: C.rule, paddingBottom: 3 },
  h3: { fontSize: 9.5, fontFamily: 'Helvetica-Bold', color: C.ink, marginTop: 8, marginBottom: 3 },
  p: { marginBottom: 5 },
  row: { flexDirection: 'row', marginBottom: 3 },
  label: { width: 118, color: C.muted, fontSize: 8.5 },
  value: { flex: 1, fontSize: 9 },
  box: { backgroundColor: C.wash, padding: 8, borderRadius: 3, marginBottom: 6 },
  why: { flexDirection: 'row', marginBottom: 4, paddingLeft: 8,
         borderLeftWidth: 2, borderLeftColor: C.brand },
  whyNum: { width: 16, fontFamily: 'Helvetica-Bold', color: C.brand, fontSize: 9 },
  tableHead: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: C.ink,
               paddingBottom: 3, marginBottom: 4 },
  th: { fontSize: 8, fontFamily: 'Helvetica-Bold', color: C.ink },
  tr: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: C.rule,
        paddingVertical: 3 },
  td: { fontSize: 8.5 },
  alert: { color: C.alert, fontFamily: 'Helvetica-Bold' },
  footer: { position: 'absolute', bottom: 26, left: 44, right: 44, flexDirection: 'row',
            justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: C.rule,
            paddingTop: 5, fontSize: 7.5, color: C.muted },
  note: { fontSize: 7.5, color: C.muted, fontStyle: 'italic', marginTop: 3 },
});

const title = (v: string | null | undefined) =>
  v ? v.charAt(0) + v.slice(1).toLowerCase().replace(/_/g, ' ') : '—';

const dt = (d: Date | string | null | undefined) =>
  d ? new Date(d).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : '—';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={s.row}>
      <Text style={s.label}>{label}</Text>
      <Text style={s.value}>{children}</Text>
    </View>
  );
}

export interface EvidencePackData {
  orgName: string;
  generatedAt: Date;
  generatedBy: string;
  incident: {
    reference: string; report_type: string; status: string; title: string | null;
    description: string; immediate_action: string | null; work_area: string | null;
    severity: string | null; likelihood: string | null; risk_score: number | null;
    risk_band: string | null; occurred_at: Date; reported_at: Date;
    acknowledged_at: Date | null; closed_at: Date | null; closure_statement: string | null;
    lessons_learned: string | null; lost_time: boolean; reportable_to_authority: boolean;
    is_anonymous: boolean; source: string;
    siteName: string; departmentName: string | null; reporterName: string | null;
  };
  persons: {
    full_name: string | null; involvement: string; treatment: string | null;
    days_lost: number | null; statement: string | null; redacted: boolean;
  }[];
  investigation: {
    status: string; leadName: string | null; assigned_at: Date; due_at: Date;
    submitted_at: Date | null; approved_at: Date | null; approverName: string | null;
    summary: string | null;
    timeline: { occurred_at: Date; description: string }[];
    interviews: { name: string | null; interviewed_at: Date; notes: string; withheld: boolean }[];
    findings: { finding_type: string; statement: string }[];
    rootCauses: {
      statement: string; category: string; problem_statement: string;
      whys: { step: number; question: string; answer: string }[];
    }[];
  } | null;
  actions: {
    reference: string; title: string; action_type: string; hierarchy_level: string;
    status: string; ownerName: string | null; verifierName: string | null;
    original_due_date: Date; due_date: Date; verified_at: Date | null;
    effectiveness: string | null; verification_comments: string | null;
  }[];
  attachments: { file_name: string; mime_type: string; size_bytes: number; created_at: Date }[];
  audit: {
    created_at: Date; action: string; actor: string | null; changes: unknown;
  }[];
}

function Pack(d: EvidencePackData): ReactElement<DocumentProps> {
  const i = d.incident;
  const packId = `${i.reference}/${d.generatedAt.toISOString().slice(0, 10)}`;

  return (
    <Document
      title={`Incident evidence pack — ${i.reference}`}
      author={d.orgName}
      subject="Workplace incident evidence pack"
    >
      <Page size="A4" style={s.page}>
        <View style={s.header} fixed>
          <Text style={s.brand}>SafeSphere EHS</Text>
          <Text style={s.org}>{d.orgName}</Text>
        </View>

        <Text style={s.title}>Incident evidence pack</Text>
        <Text style={s.ref}>{i.reference}</Text>

        <Text style={s.h2}>1. Event</Text>
        <Field label="Type">{title(i.report_type)}</Field>
        <Field label="Status">{title(i.status)}</Field>
        <Field label="Occurred">{dt(i.occurred_at)}</Field>
        <Field label="Reported">{dt(i.reported_at)}</Field>
        <Field label="Acknowledged">{dt(i.acknowledged_at)}</Field>
        <Field label="Closed">{dt(i.closed_at)}</Field>
        <Field label="Site">{i.siteName}{i.departmentName ? ` — ${i.departmentName}` : ''}</Field>
        <Field label="Work area">{i.work_area ?? '—'}</Field>
        <Field label="Severity">
          {title(i.severity)}
          {i.likelihood ? ` · likelihood ${title(i.likelihood)}` : ''}
          {i.risk_score != null ? ` · risk ${i.risk_score} (${title(i.risk_band)})` : ''}
        </Field>
        <Field label="Lost time">{i.lost_time ? 'Yes' : 'No'}</Field>
        <Field label="Reportable">{i.reportable_to_authority ? 'Yes — authority notified' : 'No'}</Field>
        <Field label="Reported by">
          {i.is_anonymous ? 'Anonymous' : (i.reporterName ?? 'Unknown')} (via {title(i.source)})
        </Field>

        <Text style={s.h3}>What happened</Text>
        <View style={s.box}><Text>{i.description}</Text></View>

        {i.immediate_action && (
          <>
            <Text style={s.h3}>Immediate action taken</Text>
            <View style={s.box}><Text>{i.immediate_action}</Text></View>
          </>
        )}

        <Text style={s.h2}>2. People</Text>
        {d.persons.length === 0 ? (
          <Text style={s.p}>No individuals recorded against this event.</Text>
        ) : (
          d.persons.map((p, n) => (
            <View key={n} style={s.box}>
              <Text style={{ fontFamily: 'Helvetica-Bold' }}>
                {p.full_name ?? 'Named user'} — {title(p.involvement)}
              </Text>
              {p.redacted ? (
                <Text style={s.note}>
                  Injury and health detail withheld from this export. It is visible to the HSE
                  manager, the assigned investigator, and the person the record concerns.
                </Text>
              ) : (
                <>
                  {p.treatment && (
                    <Text>
                      Treatment: {title(p.treatment)}
                      {p.days_lost != null ? ` · ${p.days_lost} days lost` : ''}
                    </Text>
                  )}
                  {p.statement && <Text>{p.statement}</Text>}
                </>
              )}
            </View>
          ))
        )}

        <View style={s.footer} fixed>
          <Text>{packId}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>

      <Page size="A4" style={s.page}>
        <View style={s.header} fixed>
          <Text style={s.brand}>SafeSphere EHS</Text>
          <Text style={s.org}>{i.reference}</Text>
        </View>

        <Text style={s.h2}>3. Investigation</Text>
        {!d.investigation ? (
          <Text style={s.p}>No investigation was opened for this event.</Text>
        ) : (
          <>
            <Field label="Status">{title(d.investigation.status)}</Field>
            <Field label="Lead investigator">{d.investigation.leadName ?? '—'}</Field>
            <Field label="Assigned">{dt(d.investigation.assigned_at)}</Field>
            <Field label="Due">{dt(d.investigation.due_at)}</Field>
            <Field label="Submitted">{dt(d.investigation.submitted_at)}</Field>
            <Field label="Approved">
              {dt(d.investigation.approved_at)}
              {d.investigation.approverName ? ` by ${d.investigation.approverName}` : ''}
            </Field>

            {d.investigation.summary && (
              <>
                <Text style={s.h3}>Summary</Text>
                <View style={s.box}><Text>{d.investigation.summary}</Text></View>
              </>
            )}

            {d.investigation.timeline.length > 0 && (
              <>
                <Text style={s.h3}>Sequence of events</Text>
                {d.investigation.timeline.map((t, n) => (
                  <View key={n} style={s.row}>
                    <Text style={s.label}>{dt(t.occurred_at)}</Text>
                    <Text style={s.value}>{t.description}</Text>
                  </View>
                ))}
              </>
            )}

            {d.investigation.interviews.length > 0 && (
              <>
                <Text style={s.h3}>Interviews</Text>
                {d.investigation.interviews.map((iv, n) => (
                  <View key={n} style={s.box}>
                    <Text style={{ fontFamily: 'Helvetica-Bold' }}>
                      {iv.name ?? 'Named user'} · {dt(iv.interviewed_at)}
                    </Text>
                    <Text style={iv.withheld ? s.note : undefined}>{iv.notes}</Text>
                  </View>
                ))}
              </>
            )}

            {d.investigation.findings.length > 0 && (
              <>
                <Text style={s.h3}>Findings</Text>
                {d.investigation.findings.map((f, n) => (
                  <Text key={n} style={s.p}>
                    • [{title(f.finding_type)}] {f.statement}
                  </Text>
                ))}
              </>
            )}

            <Text style={s.h2}>4. Root cause analysis</Text>
            {d.investigation.rootCauses.length === 0 ? (
              <Text style={s.p}>No root cause was recorded.</Text>
            ) : (
              d.investigation.rootCauses.map((rc, n) => (
                <View key={n} wrap={false} style={{ marginBottom: 10 }}>
                  <Text style={s.h3}>
                    Root cause {n + 1} — {title(rc.category)}
                  </Text>
                  <Text style={s.p}>Problem: {rc.problem_statement}</Text>
                  {rc.whys.map((w) => (
                    <View key={w.step} style={s.why}>
                      <Text style={s.whyNum}>{w.step}.</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: C.muted }}>{w.question}</Text>
                        <Text>{w.answer}</Text>
                      </View>
                    </View>
                  ))}
                  <View style={[s.box, { marginTop: 4 }]}>
                    <Text style={{ fontFamily: 'Helvetica-Bold' }}>Root cause: {rc.statement}</Text>
                  </View>
                </View>
              ))
            )}
          </>
        )}

        <View style={s.footer} fixed>
          <Text>{packId}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>

      <Page size="A4" style={s.page}>
        <View style={s.header} fixed>
          <Text style={s.brand}>SafeSphere EHS</Text>
          <Text style={s.org}>{i.reference}</Text>
        </View>

        <Text style={s.h2}>5. Corrective and preventive actions</Text>
        {d.actions.length === 0 ? (
          <Text style={s.p}>No actions were raised.</Text>
        ) : (
          d.actions.map((a, n) => {
            const late = a.verified_at && a.verified_at > a.due_date;
            const extended = a.original_due_date.getTime() !== a.due_date.getTime();
            return (
              <View key={n} wrap={false} style={{ marginBottom: 9 }}>
                <Text style={{ fontFamily: 'Helvetica-Bold', color: C.ink }}>
                  {a.reference} — {a.title}
                </Text>
                <Field label="Type">
                  {title(a.action_type)} · {title(a.hierarchy_level)} control
                </Field>
                <Field label="Owner">{a.ownerName ?? '—'}</Field>
                <Field label="Verified by">{a.verifierName ?? '—'}</Field>
                <Field label="Due">
                  {a.due_date.toISOString().slice(0, 10)}
                  {extended
                    ? ` (extended from ${a.original_due_date.toISOString().slice(0, 10)})`
                    : ''}
                </Field>
                <Field label="Status">
                  {title(a.status)}
                  {a.verified_at ? ` on ${a.verified_at.toISOString().slice(0, 10)}` : ''}
                  {late ? ' — after the due date' : ''}
                </Field>
                {a.effectiveness && <Field label="Effectiveness">{title(a.effectiveness)}</Field>}
                {a.verification_comments && (
                  <View style={s.box}><Text>{a.verification_comments}</Text></View>
                )}
              </View>
            );
          })
        )}

        {i.closure_statement && (
          <>
            <Text style={s.h2}>6. Closure</Text>
            <View style={s.box}><Text>{i.closure_statement}</Text></View>
            {i.lessons_learned && (
              <>
                <Text style={s.h3}>Lessons learned</Text>
                <View style={s.box}><Text>{i.lessons_learned}</Text></View>
              </>
            )}
          </>
        )}

        <Text style={s.h2}>7. Attached evidence</Text>
        {d.attachments.length === 0 ? (
          <Text style={s.p}>No files were attached to this event.</Text>
        ) : (
          <>
            <View style={s.tableHead}>
              <Text style={[s.th, { flex: 3 }]}>File</Text>
              <Text style={[s.th, { flex: 1.4 }]}>Type</Text>
              <Text style={[s.th, { width: 60 }]}>Size</Text>
              <Text style={[s.th, { width: 92 }]}>Uploaded</Text>
            </View>
            {d.attachments.map((f, n) => (
              <View key={n} style={s.tr}>
                <Text style={[s.td, { flex: 3 }]}>{f.file_name}</Text>
                <Text style={[s.td, { flex: 1.4 }]}>{f.mime_type}</Text>
                <Text style={[s.td, { width: 60 }]}>
                  {(Number(f.size_bytes) / 1024).toFixed(0)} KB
                </Text>
                <Text style={[s.td, { width: 92 }]}>
                  {f.created_at.toISOString().slice(0, 10)}
                </Text>
              </View>
            ))}
            <Text style={s.note}>
              Files are listed rather than embedded. They remain available in the system and are
              released only through short-lived, permission-checked links.
            </Text>
          </>
        )}

        <View style={s.footer} fixed>
          <Text>{packId}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>

      <Page size="A4" style={s.page}>
        <View style={s.header} fixed>
          <Text style={s.brand}>SafeSphere EHS</Text>
          <Text style={s.org}>{i.reference}</Text>
        </View>

        <Text style={s.h2}>8. Audit trail</Text>
        <Text style={[s.p, s.note]}>
          Append-only. The application can add entries and read them; it holds no permission to
          alter or remove one.
        </Text>
        <View style={s.tableHead}>
          <Text style={[s.th, { width: 104 }]}>When (UTC)</Text>
          <Text style={[s.th, { width: 74 }]}>Action</Text>
          <Text style={[s.th, { width: 92 }]}>By</Text>
          <Text style={[s.th, { flex: 1 }]}>Change</Text>
        </View>
        {d.audit.map((e, n) => (
          <View key={n} style={s.tr}>
            <Text style={[s.td, { width: 104 }]}>{dt(e.created_at)}</Text>
            <Text style={[s.td, { width: 74 }]}>{title(e.action)}</Text>
            <Text style={[s.td, { width: 92 }]}>{e.actor ?? 'system'}</Text>
            <Text style={[s.td, { flex: 1 }]}>
              {e.changes ? JSON.stringify(e.changes).slice(0, 150) : '—'}
            </Text>
          </View>
        ))}

        <View style={{ marginTop: 20, borderTopWidth: 1, borderTopColor: C.rule, paddingTop: 8 }}>
          <Text style={s.note}>
            Generated {dt(d.generatedAt)} by {d.generatedBy} from {d.orgName}&apos;s SafeSphere EHS
            record for {i.reference}. This pack reproduces the record as held at that moment;
            producing it is itself recorded in the audit trail.
          </Text>
        </View>

        <View style={s.footer} fixed>
          <Text>{packId}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export function renderEvidencePack(data: EvidencePackData): Promise<Buffer> {
  return renderToBuffer(Pack(data));
}
