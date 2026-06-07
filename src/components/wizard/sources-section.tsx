"use client";

import type { UseFormSetValue } from "react-hook-form";
import type { DnsConfConfig } from "@/domain/dnsconf-config";
import { useLocale } from "@/lib/i18n/context";
import { Field, textareaClass } from "@/components/ui";
import { Tooltip } from "@/components/ui/tooltip";
import { SourceListInput } from "./source-list-input";
import { parseExcludeDomains } from "./utils";

export function SourcesSection({
  blocklists,
  redirects,
  redirectExclusions,
  setValue,
  blocklistsError,
  redirectsError,
  redirectExclusionsError
}: {
  blocklists: string[];
  redirects: string[];
  redirectExclusions: string[];
  setValue: UseFormSetValue<DnsConfConfig>;
  blocklistsError?: string;
  redirectsError?: string;
  redirectExclusionsError?: string;
}) {
  const { t } = useLocale();
  return (
    <section className="flex flex-col gap-4 rounded-lg border border-line bg-paper p-4">
      <div className="rounded-lg border border-line bg-white p-4">
        <div className="mb-3 font-semibold text-ink">{t('sources.redirect')}</div>
        <SourceListInput
          label={t('sources.sourceUrls')}
          tooltip={t('sources.redirectTooltip')}
          values={redirects ?? []}
          onChange={(values) =>
            setValue("redirects", values, { shouldDirty: true, shouldValidate: true })
          }
          placeholder={t('sources.redirectPlaceholder')}
          error={redirectsError}
        />
      </div>
      <div className="rounded-lg border border-line bg-white p-4">
        <div className="mb-3 font-semibold text-ink">{t('sources.block')}</div>
        <SourceListInput
          label={t('sources.sourceUrls')}
          tooltip={t('sources.blockTooltip')}
          values={blocklists ?? []}
          onChange={(values) =>
            setValue("blocklists", values, { shouldDirty: true, shouldValidate: true })
          }
          placeholder={t('sources.blockPlaceholder')}
          error={blocklistsError}
        />
      </div>
      <div className="rounded-lg border border-line bg-white p-4">
        <div className="mb-3 font-semibold text-ink">{t('sources.excludeRedirect')}</div>
        <Field
          label={<span className="inline-flex items-center gap-1.5">{t('sources.domains')}<Tooltip text={t('sources.excludeTooltip')} /></span>}
          error={redirectExclusionsError}
        >
          <textarea
            className={textareaClass}
            value={(redirectExclusions ?? []).join("\n")}
            onChange={(e) =>
              setValue("redirectExclusions", parseExcludeDomains(e.target.value), { shouldDirty: true, shouldValidate: true })
            }
            placeholder={t('sources.excludePlaceholder')}
          />
        </Field>
      </div>
    </section>
  );
}
