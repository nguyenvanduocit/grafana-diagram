import { AbsoluteTimeRange, FieldConfigSource, GrafanaTheme2, InterpolateFunction, TimeZone } from '@grafana/data';
import { CustomScrollbar, VizLegendItem, stylesFactory, VizLegend } from '@grafana/ui';
import { defaultMermaidOptions } from 'config/diagramDefaults';
import DiagramErrorBoundary from 'DiagramErrorBoundary';
import { css } from '@emotion/css';
import { merge } from 'lodash';
import mermaid from 'mermaid';
import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { updateDiagramStyle } from 'visualizers/updateDiagramStyle';
import { DiagramOptions, DiagramSeriesModel, DiagramSeriesValue } from 'config/types';

const mermaidAPI = mermaid.mermaidAPI;

export interface DiagramPanelControllerProps {
  theme: GrafanaTheme2;
  id: number;
  width: number;
  height: number;
  options: DiagramOptions;
  fieldConfig: FieldConfigSource;
  data: DiagramSeriesModel[];
  timeZone: TimeZone;
  replaceVariables: InterpolateFunction;
  onOptionsChange: (options: DiagramOptions) => void;
  onChangeTimeRange: (timeRange: AbsoluteTimeRange) => void;
}

interface DiagramStyles {
  diagramContainer: string;
  wrapper: string;
  legendContainer: string;
}

const getDiagramWithLegendStyles = stylesFactory(({ options }: DiagramPanelControllerProps): DiagramStyles => ({
  wrapper: css`
    display: flex;
    flex-direction: ${options.legend.placement === 'bottom' ? 'column' : 'row'};
    height: 100%;
  `,
  diagramContainer: css`
    min-height: 65%;
    flex-grow: 1;
  `,
  legendContainer: css`
    padding: 10px 0;
    max-height: ${options.legend.placement === 'bottom' ? '35%' : 'none'};
  `,
}));

export function DiagramPanelController(props: DiagramPanelControllerProps) {
  const { theme, id, options, data, replaceVariables, onOptionsChange } = props;
  const diagramRef = useRef<HTMLDivElement>(null);

  const styles = useMemo(() => getDiagramWithLegendStyles(props), [props]);

  const contentProcessor = useCallback((content: string): string => {
    const baseTheme = theme.isDark ? 'dark' : 'base';
    // check if the diagram definition already contains an init block
    const match = content.match(/%%\{[\s\S]*?\}%%/);
    // if it does, just return the original content
    if (match && match.length > 0) {
      return content;
    } else {
      // otherwise inject the variables from the options
      let overrides;
      if (theme.isDark) {
        overrides = {
          ...options.mermaidThemeVariablesDark.common,
          ...options.mermaidThemeVariablesDark.classDiagram,
          ...options.mermaidThemeVariablesDark.flowChart,
          ...options.mermaidThemeVariablesDark.sequenceDiagram,
          ...options.mermaidThemeVariablesDark.stateDiagram,
          ...options.mermaidThemeVariablesDark.userJourneyDiagram,
        };
      } else {
        overrides = {
          ...options.mermaidThemeVariablesLight.common,
          ...options.mermaidThemeVariablesLight.classDiagram,
          ...options.mermaidThemeVariablesLight.flowChart,
          ...options.mermaidThemeVariablesLight.sequenceDiagram,
          ...options.mermaidThemeVariablesLight.stateDiagram,
          ...options.mermaidThemeVariablesLight.userJourneyDiagram,
        };
      }

      const customTheme = `%%{init: {'theme': '${baseTheme}', 'themeVariables': ${JSON.stringify(overrides)}}}%%\n`;
      return customTheme + content;
    }
  }, [theme, options]);

  const getRemoteDiagramDefinition = useCallback(async (url: string): Promise<string> => {
    const response = await fetch(replaceVariables(url));
    if (!response.ok) {
      throw new Error(`Failed to fetch diagram definition: ${response.status} ${response.statusText}`);
    }
    return await response.text();
  }, [replaceVariables]);

  const loadDiagramDefinition = useCallback((): Promise<string> => {
    if (options.contentUrl) {
      return getRemoteDiagramDefinition(options.contentUrl);
    } else {
      return Promise.resolve(options.content);
    }
  }, [options.contentUrl, options.content, getRemoteDiagramDefinition]);

  const initializeMermaid = useCallback(async () => {
    const mermaidOptions = merge({}, defaultMermaidOptions, { theme: theme.isDark ? 'dark' : 'base' });
    mermaid.initialize(mermaidOptions);

    if (diagramRef.current) {
      const diagramDefinition = await loadDiagramDefinition();
      try {
        const diagramId = `diagram-${id}`;
        const interpolated = replaceVariables(contentProcessor(diagramDefinition));

        try {
          const { svg, bindFunctions } = await mermaidAPI.render(diagramId, interpolated);
          diagramRef.current.innerHTML = svg;
          if (bindFunctions) {
            bindFunctions(diagramRef.current);
          }
        } catch (err) {
          //console.log("Trying to apply the default theme: ", err);
          const { svg, bindFunctions } = await mermaidAPI.render(diagramId, diagramDefinition);
          diagramRef.current.innerHTML = svg;
          if (bindFunctions) {
            bindFunctions(diagramRef.current);
          }
        }
        updateDiagramStyle(diagramRef.current, data, options, diagramId);
      } catch (err) {
        diagramRef.current.innerHTML = `<div><p>Error rendering diagram. Check the diagram definition</p><p>${err}</p></div>`;
      }
    }
  }, [theme, id, data, options, replaceVariables, contentProcessor, loadDiagramDefinition]);

  useEffect(() => {
    initializeMermaid();
  }, [initializeMermaid]);

  const onToggleSort = useCallback((sortBy: string) => {
    onOptionsChange({
      ...options,
      legend: {
        ...options.legend,
        sortBy,
        sortDesc: sortBy === options.legend.sortBy ? !options.legend.sortDesc : false,
      },
    });
  }, [onOptionsChange, options]);

  const shouldHideLegendItem = useCallback((seriesData: DiagramSeriesValue[][], hideEmpty = false, hideZero = false) => {
    const isZeroOnlySeries = seriesData.reduce((acc, current) => acc + (current[1] || 0), 0) === 0;
    const isNullOnlySeries = !seriesData.reduce((acc, current) => acc && current[1] !== null, true);

    return (hideEmpty && isNullOnlySeries) || (hideZero && isZeroOnlySeries);
  }, []);

  const getLegendItems = useCallback((): VizLegendItem[] => {
    return data.reduce<VizLegendItem[]>((acc, s) => {
      return shouldHideLegendItem(s.data, options.legend.hideEmpty, options.legend.hideZero)
        ? acc
        : acc.concat([
            {
              label: s.label,
              color: '',
              disabled: !s.isVisible,
              yAxis: 0,
              getDisplayValues: () => {
                return s.info || [];
              },
            },
          ]);
    }, []);
  }, [data, options.legend.hideEmpty, options.legend.hideZero, shouldHideLegendItem]);

  return (
    <div className={`diagram-container diagram-container-${id} ${styles.wrapper}`}>
      <div
        ref={diagramRef}
        className={`diagram diagram-${id} ${styles.diagramContainer}`}
      ></div>
      {options.legend.show && (
        <div className={styles.legendContainer}>
          <CustomScrollbar hideHorizontalTrack>
            <DiagramErrorBoundary fallback="Error rendering Legend">
              <VizLegend
                items={getLegendItems()}
                displayMode={options.legend.displayMode}
                placement={options.legend.placement}
                sortBy={options.legend.sortBy}
                sortDesc={options.legend.sortDesc}
                onLabelClick={(item, event) => {}}
                onToggleSort={onToggleSort}
              />
            </DiagramErrorBoundary>
          </CustomScrollbar>
        </div>
      )}
    </div>
  );
}
