import {
  isDeletingAllRecords,
  isRemovingLastNsRecord,
  validateResource,
  type DnsRecord,
} from "@alice-hns-wallet/domain";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createRoute, Link, useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { reauth } from "../api/auth.js";
import { ApiError } from "../api/client.js";
import {
  getName,
  previewUpdateName,
  updateName,
  type DnsRecordResponse,
  type UpdatePreviewResponse,
} from "../api/names.js";
import { useSession } from "../hooks/useSession.js";
import {
  blankRecord,
  describeRecord,
  RECORD_TYPES,
  type EditableRecordType,
} from "../lib/dns-records.js";
import { shakeshiftNameUrl, shakeshiftTransactionUrl } from "../lib/shakeshift.js";
import { rootRoute } from "./root.js";

export const nameEditRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/names/$name/edit",
  component: NameEditPage,
});

function updateRecordField(
  record: DnsRecordResponse,
  patch: Partial<DnsRecordResponse>,
): DnsRecordResponse {
  return { ...record, ...patch } as DnsRecordResponse;
}

function RecordFields({
  record,
  onChange,
}: {
  record: DnsRecordResponse;
  onChange: (next: DnsRecordResponse) => void;
}) {
  switch (record.type) {
    case "NS":
      return (
        <div className="field">
          <label>Nameserver hostname</label>
          <input
            value={record.ns}
            placeholder="ns1.example.com."
            onChange={(e) => onChange(updateRecordField(record, { ns: e.target.value }))}
          />
        </div>
      );
    case "GLUE4":
    case "GLUE6":
      return (
        <>
          <div className="field">
            <label>Nameserver hostname</label>
            <input
              value={record.ns}
              placeholder="ns1.example.com."
              onChange={(e) => onChange(updateRecordField(record, { ns: e.target.value }))}
            />
          </div>
          <div className="field">
            <label>{record.type === "GLUE4" ? "IPv4 address" : "IPv6 address"}</label>
            <input
              value={record.address}
              onChange={(e) => onChange(updateRecordField(record, { address: e.target.value }))}
            />
          </div>
        </>
      );
    case "SYNTH4":
    case "SYNTH6":
      return (
        <div className="field">
          <label>{record.type === "SYNTH4" ? "IPv4 address" : "IPv6 address"}</label>
          <input
            value={record.address}
            onChange={(e) => onChange(updateRecordField(record, { address: e.target.value }))}
          />
        </div>
      );
    case "DS":
      return (
        <>
          <div className="field">
            <label>Key tag</label>
            <input
              type="number"
              value={record.keyTag}
              onChange={(e) =>
                onChange(updateRecordField(record, { keyTag: Number(e.target.value) }))
              }
            />
          </div>
          <div className="field">
            <label>Algorithm</label>
            <input
              type="number"
              value={record.algorithm}
              onChange={(e) =>
                onChange(updateRecordField(record, { algorithm: Number(e.target.value) }))
              }
            />
          </div>
          <div className="field">
            <label>Digest type</label>
            <input
              type="number"
              value={record.digestType}
              onChange={(e) =>
                onChange(updateRecordField(record, { digestType: Number(e.target.value) }))
              }
            />
          </div>
          <div className="field">
            <label>Digest (hex)</label>
            <input
              value={record.digest}
              onChange={(e) => onChange(updateRecordField(record, { digest: e.target.value }))}
            />
          </div>
        </>
      );
    case "TXT":
      return (
        <div className="field">
          <label>Text</label>
          {record.text.map((line, i) => (
            <div className="field-row" key={i} style={{ marginBottom: 4 }}>
              <input
                value={line}
                onChange={(e) => {
                  const text = [...record.text];
                  text[i] = e.target.value;
                  onChange(updateRecordField(record, { text }));
                }}
              />
              <button
                type="button"
                className="link-button"
                onClick={() =>
                  onChange(
                    updateRecordField(record, { text: record.text.filter((_, j) => j !== i) }),
                  )
                }
              >
                Remove line
              </button>
            </div>
          ))}
          <button
            type="button"
            className="link-button"
            onClick={() => onChange(updateRecordField(record, { text: [...record.text, ""] }))}
          >
            Add line
          </button>
        </div>
      );
    case "UNKNOWN":
      return <p className="muted">Unrecognized record — kept as-is: {record.raw}</p>;
  }
}

function NameEditPage() {
  const navigate = useNavigate();
  const session = useSession();
  const queryClient = useQueryClient();
  const { name } = useParams({ from: nameEditRoute.id });

  const detailQuery = useQuery({
    queryKey: ["name", name],
    queryFn: () => getName(name),
    enabled: session.data?.authenticated === true,
  });

  const [records, setRecords] = useState<DnsRecordResponse[] | null>(null);
  const [originalRecords, setOriginalRecords] = useState<DnsRecordResponse[]>([]);
  const [confirmSafety, setConfirmSafety] = useState(false);
  const [requireNameReentry, setRequireNameReentry] = useState(true);
  const [nameReentry, setNameReentry] = useState("");
  const [preview, setPreview] = useState<UpdatePreviewResponse | null>(null);
  const [needsReauth, setNeedsReauth] = useState(false);
  const [reauthPassword, setReauthPassword] = useState("");
  const [result, setResult] = useState<{ txid: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (session.data && !session.data.authenticated) {
      void navigate({ to: "/login" });
    }
  }, [session.data, navigate]);

  useEffect(() => {
    if (detailQuery.data && records === null) {
      const initial = detailQuery.data.resource?.records ?? [];
      setRecords(initial);
      setOriginalRecords(initial);
    }
  }, [detailQuery.data, records]);

  // hsd tracks ownership of the winning coin as soon as an auction closes, before the winner has
  // ever called REGISTER — a "closed" state (rather than "owned") is what actually signals no
  // REGISTER/UPDATE has landed yet; this page produces one automatically the first time. Same page
  // as editing, different copy.
  const isRegistering = detailQuery.data?.state === "closed" && detailQuery.data?.owned;

  const currentRecords = records ?? [];
  const issues = validateResource(currentRecords as DnsRecord[]);
  const deletingAll = isDeletingAllRecords(
    originalRecords as DnsRecord[],
    currentRecords as DnsRecord[],
  );
  const removingLastNs = isRemovingLastNsRecord(
    originalRecords as DnsRecord[],
    currentRecords as DnsRecord[],
  );
  const needsSafetyConfirm = (deletingAll || removingLastNs) && !confirmSafety;
  const nameReentryOk = !requireNameReentry || nameReentry === name;

  function moveRecord(index: number, direction: -1 | 1) {
    setRecords((prev) => {
      if (!prev) return prev;
      const next = [...prev];
      const target = index + direction;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  }

  function removeRecord(index: number) {
    setRecords((prev) => (prev ? prev.filter((_, i) => i !== index) : prev));
    setPreview(null);
  }

  function addRecord(type: EditableRecordType) {
    setRecords((prev) => [...(prev ?? []), blankRecord(type)]);
    setPreview(null);
  }

  const previewMutation = useMutation({
    mutationFn: () => previewUpdateName(name, currentRecords),
    onSuccess: (p) => {
      setPreview(p);
      setError(null);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Failed to preview update"),
  });

  const updateMutation = useMutation({
    mutationFn: () => updateName(name, currentRecords),
    onSuccess: (broadcast) => {
      setResult(broadcast);
      setNeedsReauth(false);
      setError(null);
      queryClient.invalidateQueries({ queryKey: ["name", name] });
      queryClient.invalidateQueries({ queryKey: ["names"] });
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 403) {
        setNeedsReauth(true);
      } else if (err instanceof ApiError) {
        setError(err.message);
      }
    },
  });

  const reauthMutation = useMutation({
    mutationFn: () => reauth({ method: "password", password: reauthPassword }),
    onSuccess: () => {
      setNeedsReauth(false);
      setReauthPassword("");
      updateMutation.mutate();
    },
  });

  if (result) {
    return (
      <main className="dashboard">
        <div className="dashboard-header">
          <h1>{isRegistering ? "Name registered" : "DNS record updated"}</h1>
          <Link to="/names/$name" params={{ name }}>
            Back to {name}
          </Link>
        </div>
        <div className="success-banner">
          Broadcast. Transaction ID:{" "}
          <a href={shakeshiftTransactionUrl(result.txid)} target="_blank" rel="noopener noreferrer">
            <code>{result.txid}</code>
          </a>
        </div>
        <p className="muted">
          <a href={shakeshiftNameUrl(name)} target="_blank" rel="noopener noreferrer">
            View {name} on Shakeshift
          </a>
        </p>
      </main>
    );
  }

  return (
    <main className="dashboard">
      <div className="dashboard-header">
        <h1>{isRegistering ? `Register ${name}` : `Edit DNS records: ${name}`}</h1>
        <Link to="/names/$name" params={{ name }}>
          Cancel
        </Link>
      </div>

      {isRegistering && (
        <p className="muted">
          This name's auction has closed and it isn't registered yet. Submitting here — even with no
          records — completes the registration; you can add DNS records now or later.
        </p>
      )}

      {error && <div className="error-banner">{error}</div>}

      {needsReauth && (
        <div className="card">
          <h1>Confirm your password</h1>
          <p className="muted">
            {isRegistering ? "Registering this name" : "Updating DNS records"} requires
            re-authentication.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              reauthMutation.mutate();
            }}
          >
            <div className="field">
              <label htmlFor="reauth-password">Password</label>
              <input
                id="reauth-password"
                type="password"
                autoComplete="current-password"
                required
                value={reauthPassword}
                onChange={(e) => setReauthPassword(e.target.value)}
              />
            </div>
            <button type="submit" className="button" disabled={reauthMutation.isPending}>
              {isRegistering ? "Confirm and register" : "Confirm and update"}
            </button>
          </form>
        </div>
      )}

      <div className="card">
        <h1>Records</h1>
        {currentRecords.length === 0 && <p className="muted">No records yet.</p>}
        {currentRecords.map((record, index) => (
          <div className="card" key={index} style={{ background: "#f9fafb" }}>
            <div className="field-row">
              <strong>{record.type}</strong>
              <button type="button" className="link-button" onClick={() => moveRecord(index, -1)}>
                Move up
              </button>
              <button type="button" className="link-button" onClick={() => moveRecord(index, 1)}>
                Move down
              </button>
              <button type="button" className="link-button" onClick={() => removeRecord(index)}>
                Remove
              </button>
            </div>
            <RecordFields
              record={record}
              onChange={(next) => {
                setRecords((prev) => {
                  if (!prev) return prev;
                  const copy = [...prev];
                  copy[index] = next;
                  return copy;
                });
                setPreview(null);
              }}
            />
            {issues
              .filter((i) => i.index === index)
              .map((i) => (
                <p key={i.code} className="error-banner">
                  {i.message}
                </p>
              ))}
          </div>
        ))}

        <div className="field-row" style={{ flexWrap: "wrap" }}>
          {RECORD_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              className="button secondary"
              onClick={() => addRecord(type)}
            >
              Add {type}
            </button>
          ))}
        </div>
      </div>

      {(deletingAll || removingLastNs) && (
        <div className="error-banner">
          {deletingAll && <p>Warning: this removes every record from {name}.</p>}
          {removingLastNs && <p>Warning: this removes the last NS record from {name}.</p>}
          <label className="field-row">
            <input
              type="checkbox"
              checked={confirmSafety}
              onChange={(e) => setConfirmSafety(e.target.checked)}
            />
            I understand and want to proceed
          </label>
        </div>
      )}

      <div className="card">
        <h1>Confirmation</h1>
        <label className="field-row">
          <input
            type="checkbox"
            checked={requireNameReentry}
            onChange={(e) => setRequireNameReentry(e.target.checked)}
          />
          Require typing the name to confirm
        </label>
        {requireNameReentry && (
          <div className="field">
            <label htmlFor="name-reentry">Type "{name}" to confirm</label>
            <input
              id="name-reentry"
              value={nameReentry}
              onChange={(e) => setNameReentry(e.target.value)}
            />
          </div>
        )}

        {!preview ? (
          <button
            type="button"
            className="button"
            disabled={
              issues.length > 0 || needsSafetyConfirm || !nameReentryOk || previewMutation.isPending
            }
            onClick={() => previewMutation.mutate()}
          >
            {previewMutation.isPending ? "Building preview…" : "Preview changes"}
          </button>
        ) : (
          <>
            <div className="success-banner">
              <p>Fee: {preview.fee} dollarydoos</p>
              <p>New resource size: {preview.resource.size} bytes</p>
              <p>
                Raw: <code>{preview.resource.raw}</code>
              </p>
            </div>

            <p>
              <strong>Before:</strong>
            </p>
            <ul>
              {originalRecords.length === 0 && <li className="muted">(no records)</li>}
              {originalRecords.map((r, i) => (
                <li key={i}>{describeRecord(r)}</li>
              ))}
            </ul>
            <p>
              <strong>After:</strong>
            </p>
            <ul>
              {currentRecords.length === 0 && <li className="muted">(no records)</li>}
              {currentRecords.map((r, i) => (
                <li key={i}>{describeRecord(r)}</li>
              ))}
            </ul>

            <div className="field-row">
              <button type="button" className="button secondary" onClick={() => setPreview(null)}>
                Back to editing
              </button>
              <button
                type="button"
                className="button"
                disabled={updateMutation.isPending}
                onClick={() => updateMutation.mutate()}
              >
                {updateMutation.isPending
                  ? isRegistering
                    ? "Registering…"
                    : "Updating…"
                  : isRegistering
                    ? "Confirm registration"
                    : "Confirm update"}
              </button>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
