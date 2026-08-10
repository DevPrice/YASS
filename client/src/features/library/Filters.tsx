/**
 * Search and filter controls.
 *
 * Search is always visible; the rest collapses behind a toggle so the phone
 * layout stays mostly list.
 */

import { useState } from 'react'
import type { Ref } from 'react'

import type { InstrumentGroup, SongFacets } from '@shared/types'
import { INSTRUMENT_GROUPS } from '@shared/types'
import { Button, Select, TextField, ToggleChip, cx } from '../../ui'
import { formatSource } from '../../lib/format'
import type { Filters } from './filtering'
import { EMPTY_FILTERS, hasActiveFilters } from './filtering'

/** Cap facet dropdowns so a library with thousands of charters stays usable. */
const MAX_FACET_OPTIONS = 200

const INSTRUMENT_LABELS: Record<InstrumentGroup, string> = {
  guitar: 'Guitar',
  bass: 'Bass',
  drums: 'Drums',
  keys: 'Keys',
  vocals: 'Vocals',
}

interface FiltersPanelProps {
  filters: Filters
  onChange: (filters: Filters) => void
  facets: SongFacets
  resultCount: number
  totalCount: number
  /** Lets the `/` shortcut in the helper bar focus the search field. */
  searchRef?: Ref<HTMLInputElement>
}

export function FiltersPanel({
  filters,
  onChange,
  facets,
  resultCount,
  totalCount,
  searchRef,
}: FiltersPanelProps) {
  const [expanded, setExpanded] = useState(false)

  const update = <K extends keyof Filters>(key: K, value: Filters[K]) => {
    onChange({ ...filters, [key]: value })
  }

  const toggleInstrument = (group: InstrumentGroup) => {
    const active = filters.instruments.includes(group)
    update(
      'instruments',
      active ? filters.instruments.filter((g) => g !== group) : [...filters.instruments, group],
    )
  }

  /** Facet dropdowns are single-select for now; '' means "no filter". */
  const singleSelect = (key: 'sources' | 'genres' | 'formats', value: string) => {
    update(key, value === '' ? [] : [value])
  }

  const active = hasActiveFilters(filters)

  return (
    <div className="flex shrink-0 flex-col gap-[15px] bg-surface-app px-[25px] py-[15px]">
      <div className="flex items-center gap-[10px]">
        <TextField
          inputRef={searchRef}
          className="flex-1"
          type="search"
          inputMode="search"
          placeholder="Search title, artist, album, charter…"
          value={filters.search}
          onChange={(event) => update('search', event.target.value)}
          leading={<SearchIcon />}
          aria-label="Search songs"
        />

        <Button
          tone={expanded ? 'accent' : 'neutral'}
          onClick={() => setExpanded((previous) => !previous)}
          aria-expanded={expanded}
        >
          filters
          {active ? <span aria-hidden>•</span> : null}
        </Button>
      </div>

      {/* Numbers are shown, not described: bright count, dim unit. */}
      <div className="flex items-center justify-between gap-[15px]">
        <span aria-live="polite" className="font-numeric flex items-baseline gap-[5px] text-[15px]">
          <span className="font-bold text-count">{resultCount.toLocaleString()}</span>
          {resultCount !== totalCount ? (
            <span className="text-count-muted">of {totalCount.toLocaleString()}</span>
          ) : null}
          <span className="text-count-muted uppercase">songs</span>
        </span>

        {active ? (
          <button
            type="button"
            onClick={() => onChange(EMPTY_FILTERS)}
            className="yarg-label cursor-pointer text-[11px] text-accent hover:text-white"
          >
            clear filters
          </button>
        ) : null}
      </div>

      <div className={cx('flex flex-col gap-[15px]', !expanded && 'hidden')}>
        <div className="flex flex-wrap gap-[10px]">
          <span className="yarg-label self-center text-[11px] text-count-muted">has parts</span>
          {INSTRUMENT_GROUPS.map((group) => (
            <ToggleChip
              key={group}
              active={filters.instruments.includes(group)}
              onClick={() => toggleInstrument(group)}
            >
              {INSTRUMENT_LABELS[group]}
            </ToggleChip>
          ))}
          <ToggleChip
            active={filters.masterOnly}
            onClick={() => update('masterOnly', !filters.masterOnly)}
            title="Master recordings only (exclude covers)"
          >
            Master only
          </ToggleChip>
        </div>

        <div className="grid grid-cols-1 gap-[15px] sm:grid-cols-2 lg:grid-cols-4">
          <FacetSelect
            label="source"
            value={filters.sources[0] ?? ''}
            options={facets.sources}
            format={formatSource}
            onChange={(value) => singleSelect('sources', value)}
          />
          <FacetSelect
            label="genre"
            value={filters.genres[0] ?? ''}
            options={facets.genres}
            onChange={(value) => singleSelect('genres', value)}
          />
          <FacetSelect
            label="format"
            value={filters.formats[0] ?? ''}
            options={facets.formats}
            onChange={(value) => singleSelect('formats', value)}
          />

          <div className="flex gap-[10px]">
            <Select
              label="min diff"
              value={filters.minDifficulty ?? ''}
              onChange={(event) =>
                update('minDifficulty', event.target.value === '' ? null : Number(event.target.value))
              }
            >
              <option value="">Any</option>
              {[0, 1, 2, 3, 4, 5, 6].map((tier) => (
                <option key={tier} value={tier}>
                  {tier}
                </option>
              ))}
            </Select>
            <Select
              label="max diff"
              value={filters.maxDifficulty ?? ''}
              onChange={(event) =>
                update('maxDifficulty', event.target.value === '' ? null : Number(event.target.value))
              }
            >
              <option value="">Any</option>
              {[0, 1, 2, 3, 4, 5, 6].map((tier) => (
                <option key={tier} value={tier}>
                  {tier}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </div>
    </div>
  )
}

function FacetSelect({
  label,
  value,
  options,
  onChange,
  format = (raw: string) => raw,
}: {
  label: string
  value: string
  options: Array<{ value: string; count: number }>
  onChange: (value: string) => void
  format?: (raw: string) => string
}) {
  return (
    <Select label={label} value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">All</option>
      {options.slice(0, MAX_FACET_OPTIONS).map((option) => (
        <option key={option.value} value={option.value}>
          {format(option.value)} ({option.count})
        </option>
      ))}
    </Select>
  )
}

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}
