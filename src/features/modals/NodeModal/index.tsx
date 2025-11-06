import React from "react";
import type { ModalProps } from "@mantine/core";
import { Modal, Stack, Text, ScrollArea, Flex, CloseButton, Button, Textarea, TextInput } from "@mantine/core";
import { CodeHighlight } from "@mantine/code-highlight";
import type { NodeData } from "../../../types/graph";
import useGraph from "../../editor/views/GraphView/stores/useGraph";
import useFile from "../../../store/useFile";
import { contentToJson } from "../../../lib/utils/jsonAdapter";

// return object from json removing array and object fields
const normalizeNodeData = (nodeRows: NodeData["text"]) => {
  if (!nodeRows || nodeRows.length === 0) return "{}";
  if (nodeRows.length === 1 && !nodeRows[0].key) return `${nodeRows[0].value}`;

  const obj = {};
  nodeRows?.forEach(row => {
    if (row.type !== "array" && row.type !== "object") {
      if (row.key) obj[row.key] = row.value;
    }
  });
  return JSON.stringify(obj, null, 2);
};

// return json path in the format $["customer"]
const jsonPathToString = (path?: NodeData["path"]) => {
  if (!path || path.length === 0) return "$";
  const segments = path.map(seg => (typeof seg === "number" ? seg : `"${seg}"`));
  return `$[${segments.join("][")}]`;
};

export const NodeModal = ({ opened, onClose }: ModalProps) => {
  const nodeData = useGraph(state => state.selectedNode);

  const contents = useFile(state => state.contents);
  const setContents = useFile(state => state.setContents);

  const [editing, setEditing] = React.useState(false);
  const [editValue, setEditValue] = React.useState<string>("{}");
  const [fields, setFields] = React.useState<Record<string, { value: string; type: string }>>({});
  const [singleValue, setSingleValue] = React.useState<string | null>(null);
  const [singleType, setSingleType] = React.useState<string | null>(null);
  const wrapperRef = React.useRef<HTMLDivElement | null>(null);
  const [lockDims, setLockDims] = React.useState<{ width?: number; height?: number } | null>(null);

  const normalizeEditValue = React.useCallback(() => {
    const v = normalizeNodeData(nodeData?.text ?? []);
    // trim trailing newlines
    return String(v).replace(/\n+$/g, "");
  }, [nodeData]);

  React.useEffect(() => {
    if (opened) {
      setEditing(false);
      setEditValue(normalizeEditValue());
      setLockDims(null);

      // prepare structured fields for editing
      const rows = nodeData?.text ?? [];
      if (rows.length === 1 && !rows[0].key) {
        setSingleValue(String(rows[0].value ?? ""));
        setSingleType(String(rows[0].type ?? "string"));
        setFields({});
      } else {
        const f: Record<string, { value: string; type: string }> = {};
        rows.forEach(r => {
          if (r.type !== "array" && r.type !== "object" && r.key) {
            f[r.key] = { value: String(r.value ?? ""), type: String(r.type ?? "string") };
          }
        });
        setFields(f);
        setSingleValue(null);
        setSingleType(null);
      }
    }
  }, [opened, normalizeEditValue]);

  // parse string input into appropriate primitive based on recorded type
  const parseByType = (val: string, type: string) => {
    if (type === "number") {
      const n = Number(val);
      return Number.isNaN(n) ? val : n;
    }
    if (type === "boolean") {
      return val === "true";
    }
    if (type === "null") return null;
    // default to string
    return val;
  };

  const handleEditClick = () => {
    // measure wrapper and lock dimensions so view/edit stay same size
    const rect = wrapperRef.current?.getBoundingClientRect();
    if (rect) setLockDims({ width: rect.width, height: rect.height });
    setEditing(true);
  };

  const handleCancel = () => {
    setEditing(false);
    setEditValue(normalizeEditValue());
    setLockDims(null);
    // reset structured fields
    const rows = nodeData?.text ?? [];
    if (rows.length === 1 && !rows[0].key) {
      setSingleValue(String(rows[0].value ?? ""));
      setSingleType(String(rows[0].type ?? "string"));
      setFields({});
    } else {
      const f: Record<string, { value: string; type: string }> = {};
      rows.forEach(r => {
        if (r.type !== "array" && r.type !== "object" && r.key) {
          f[r.key] = { value: String(r.value ?? ""), type: String(r.type ?? "string") };
        }
      });
      setFields(f);
      setSingleValue(null);
      setSingleType(null);
    }
  };

  const handleSave = async () => {
    try {
      const json = await contentToJson(contents);
      const path = nodeData?.path ?? [];
      // build parsedValue from structured fields (preserve types)
      let parsedValue: any = null;
      if (singleValue !== null) {
        // parse single primitive
        const t = singleType ?? "string";
        parsedValue = parseByType(singleValue, t);
      } else {
        parsedValue = {} as Record<string, any>;
        Object.keys(fields).forEach(k => {
          parsedValue[k] = parseByType(fields[k].value, fields[k].type);
        });
      }

      const newJson = JSON.parse(JSON.stringify(json));

      if (!path || path.length === 0) {
        setContents({ contents: JSON.stringify(parsedValue, null, 2) });
        onClose?.();
        return;
      }

      // reach parent
      let cur: any = newJson;
      for (let i = 0; i < path.length - 1; i++) {
        const seg = path[i] as any;
        if (cur[seg] === undefined) cur[seg] = typeof path[i + 1] === "number" ? [] : {};
        cur = cur[seg];
      }
      const last = path[path.length - 1] as any;

      if (cur[last] && typeof cur[last] === "object" && !Array.isArray(cur[last]) && typeof parsedValue === "object" && !Array.isArray(parsedValue)) {
        Object.keys(parsedValue).forEach(k => (cur[last][k] = parsedValue[k]));
      } else {
        cur[last] = parsedValue;
      }

      setContents({ contents: JSON.stringify(newJson, null, 2) });
      onClose?.();
    } catch (err) {
      // keep modal open on error
      console.warn("Failed to save node edit:", err);
    }
  };

  return (
    <Modal size="auto" opened={opened} onClose={onClose} centered withCloseButton={false}>
      <Stack pb="sm" gap="sm">
        <Stack gap="xs">
          <Flex justify="space-between" align="center">
            <Text fz="xs" fw={500}>
              Content
            </Text>
            <CloseButton onClick={onClose} />
          </Flex>

          <ScrollArea style={lockDims ? { height: lockDims.height, maxWidth: 600 } : undefined}>
            <div ref={wrapperRef} style={{ padding: 8, boxSizing: "border-box" }}>
              {!editing ? (
                <CodeHighlight
                  code={normalizeNodeData(nodeData?.text ?? [])}
                  miw={350}
                  maw={600}
                  language="json"
                  withCopyButton
                />
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {singleValue !== null ? (
                    <TextInput
                      label={nodeData?.text?.[0]?.key ?? "value"}
                      value={singleValue}
                      onChange={e => setSingleValue(e.currentTarget.value)}
                    />
                  ) : (
                    Object.keys(fields).map(key => (
                      <TextInput
                        key={key}
                        label={key}
                        value={fields[key].value}
                        onChange={e =>
                          setFields(prev => ({ ...prev, [key]: { ...prev[key], value: e.currentTarget.value } }))
                        }
                      />
                    ))
                  )}
                </div>
              )}
            </div>
          </ScrollArea>

          <Flex justify="flex-end" gap="xs">
            {!editing ? (
              <Button size="xs" variant="outline" onClick={handleEditClick}>
                Edit
              </Button>
            ) : (
              <>
                <Button size="xs" color="gray" variant="subtle" onClick={handleCancel}>
                  Cancel
                </Button>
                <Button size="xs" onClick={handleSave}>
                  Save
                </Button>
              </>
            )}
          </Flex>
        </Stack>

        <Text fz="xs" fw={500}>
          JSON Path
        </Text>
        <ScrollArea.Autosize maw={600}>
          <CodeHighlight
            code={jsonPathToString(nodeData?.path)}
            miw={350}
            mah={250}
            language="json"
            copyLabel="Copy to clipboard"
            copiedLabel="Copied to clipboard"
            withCopyButton
          />
        </ScrollArea.Autosize>
      </Stack>
    </Modal>
  );
};
