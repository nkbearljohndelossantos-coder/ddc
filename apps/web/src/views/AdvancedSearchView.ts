export interface SavedSearchItem {
  id: string;
  name: string;
  queryPayload: Record<string, any>;
  isShared: boolean;
}

export interface SearchResultItem {
  id: string;
  title: string;
  documentType: string;
  departmentId?: string;
  status: string;
  ocrConfidence: number;
  highlightSnippet?: string;
  createdAt: string;
}

export class AdvancedSearchView {
  /**
   * Renders the enterprise advanced search and saved search management interface.
   */
  public static render(savedSearches: SavedSearchItem[], results: SearchResultItem[], activeQuery = ''): string {
    const savedSearchOptions = savedSearches
      .map((s) => `<option value="${s.id}">${s.name} ${s.isShared ? '(Shared)' : '(Personal)'}</option>`)
      .join('\n');

    const resultRows = results
      .map(
        (r) => `
        <tr class="search-result-row">
          <td><a href="/documents/${r.id}">${r.title}</a></td>
          <td>${r.documentType}</td>
          <td>${r.departmentId || 'Global'}</td>
          <td>${r.ocrConfidence.toFixed(1)}%</td>
          <td><span class="badge status-badge">${r.status}</span></td>
          <td class="snippet-cell">${r.highlightSnippet || '-'}</td>
        </tr>
      `
      )
      .join('\n');

    return `
      <div class="advanced-search-container" role="region" aria-label="Advanced Search Engine">
        <header class="view-header">
          <h2>Enterprise Document Search</h2>
        </header>

        <section class="saved-searches-bar" aria-label="Saved Search Presets">
          <label for="saved-search-select">Saved Search Presets:</label>
          <select id="saved-search-select" class="form-select">
            <option value="">-- Select a saved search --</option>
            ${savedSearchOptions}
          </select>
          <button type="button" class="btn btn-outline" id="btn-load-saved-search">Load Preset</button>
        </section>

        <form class="search-form" id="advanced-search-form" role="search">
          <div class="form-group">
            <label for="search-input-query">Full-Text OCR Query</label>
            <input type="search" id="search-input-query" class="form-input" value="${activeQuery}" placeholder="Search text within scanned document content..." />
          </div>

          <div class="form-row">
            <div class="form-group">
              <label for="filter-doc-type">Document Type</label>
              <select id="filter-doc-type" class="form-select">
                <option value="">All Types</option>
                <option value="INVOICE">Invoice</option>
                <option value="CONTRACT">Contract</option>
                <option value="PAYROLL">Payroll</option>
              </select>
            </div>

            <div class="form-group">
              <label for="filter-min-confidence">Minimum Confidence (%)</label>
              <input type="number" id="filter-min-confidence" class="form-input" min="0" max="100" placeholder="e.g. 80" />
            </div>
          </div>

          <div class="form-actions">
            <button type="submit" class="btn btn-primary" id="btn-execute-search">Search Documents</button>
            <button type="button" class="btn btn-secondary" id="btn-save-search">Save Search Preset</button>
          </div>
        </form>

        <section class="search-results-section" aria-label="Search Results">
          <h3>Results (${results.length})</h3>
          <table class="data-table" aria-label="Search Results Table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Type</th>
                <th>Department</th>
                <th>OCR Conf</th>
                <th>Status</th>
                <th>Matched Snippet</th>
              </tr>
            </thead>
            <tbody>
              ${results.length > 0 ? resultRows : '<tr><td colspan="6" class="text-center">No matching documents found.</td></tr>'}
            </tbody>
          </table>
        </section>
      </div>
    `;
  }
}
