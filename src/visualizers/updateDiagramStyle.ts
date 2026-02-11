import { DisplayValue, formattedValueToString, LinkModel } from '@grafana/data';
import { select, Selection } from 'd3';
import { diagramStyleFormatter } from 'diagramStyleFormatter';
import { CompositeMetric, DiagramOptions, DiagramSeriesModel, NodeSizeOptions } from 'config/types';

type MetricIndicator = DisplayValue & {
  metricName: string;
  valueName: string;
  isComposite?: boolean;
  originalName?: string;
  links?: LinkModel[];
};

// D3 Selection type - using any for flexibility with D3's complex type system
type D3Selection = Selection<any, any, any, any>;

const selectElementById = (container: HTMLElement, id: string): D3Selection => {
  return select(container.querySelector(`[data-id="${id}"]`));
};

const selectElementByEdgeLabel = (container: HTMLElement, id: string): D3Selection => {
  return select(container)
    .selectAll('span')
    .filter(function () {
      return select(this).text() === id;
    });
};

const selectDivElementByAlias = (container: HTMLElement, alias: string): D3Selection => {
  const targetElement = select(container)
    .selectAll('div')
    .filter(function () {
      return select(this).text() === alias;
    });
  const node = targetElement.node();
  if (node != null) {
    const parentShape = (node as HTMLElement).closest('.node');
    if (parentShape != null) {
      return select(parentShape);
    }
  }
  return select(null);
};

const selectTextElementByAlias = (container: HTMLElement, alias: string): D3Selection => {
  return select(container)
    .selectAll('text')
    .filter(function () {
      return select(this).text() === alias;
    });
};

const selectTextElementContainingAlias = (container: HTMLElement, alias: string): D3Selection => {
  return select(container)
    .selectAll('text')
    .filter(function () {
      return select(this).text().includes(alias);
    });
};

const fetchParentsUntilShapeElementFound = (element: HTMLElement, selector: string): HTMLElement | null => {
  if (element.matches(selector)) {
    return element;
  }
  if (element.parentElement) {
    return fetchParentsUntilShapeElementFound(element.parentElement, selector);
  }
  return null;
}

const resizeGrouping = (element: D3Selection | null | undefined, nodeSize: NodeSizeOptions) => {
  if (!element) {
    return;
  }
  const closestGroup: HTMLElement = element.node().closest('g');
  const closestLabelGroup: HTMLElement = element.node().closest('g.label');
  const closestForeignObject: HTMLElement = element.node().closest('foreignObject');

  if (closestGroup && closestLabelGroup && closestForeignObject) {
    closestGroup.setAttribute('transform', '');
    const _minWidth = Math.max(
      Number.parseInt(closestForeignObject.getAttribute('width') || '1', 10),
      nodeSize.minWidth
    );
    const _minHeight = Math.max(
      Number.parseInt(closestForeignObject.getAttribute('height') || '1', 10),
      nodeSize.minHeight
    );
    closestForeignObject.setAttribute('height', _minHeight.toString());
    closestForeignObject.setAttribute('width', _minWidth.toString());
    closestLabelGroup.setAttribute('transform', `translate(-${_minWidth / 2},-${_minHeight / 2})`);
  }
};

const styleD3Shapes = (
  targetElement: D3Selection,
  indicator: MetricIndicator,
  useBackground: boolean,
  nodeSize: NodeSizeOptions
) => {
  const shapes = targetElement.selectAll('rect,circle,polygon,path');
  const div = targetElement.select('div');
  div.classed('diagram-value', true);
  if (div.node()) {
    const divElement = div.node() as HTMLElement;
    resizeGrouping(div, nodeSize);
    let content = divElement.innerText + `<br/> ${formattedValueToString(indicator)}`;
    if (indicator.isComposite) {
      content += `<br/>${indicator.originalName}`;
      divElement.style.marginTop = `-${nodeSize.minHeight / 4}px`;
    }
    // TODO: Add Field/Series Links??
    divElement.innerHTML = `<div style="margin:auto">${content}</div>`;
  }
  if (indicator.color) {
    if (useBackground) {
      shapes.style('fill', indicator.color);
    } else {
      div.style('color', indicator.color);
    }
  }
};

const styleFlowChartEdgeLabel = (
  targetElement: D3Selection,
  indicator: MetricIndicator,
  useBackground: boolean,
  nodeSize: NodeSizeOptions
) => {
  const edgeParent = select(targetElement.node().parentNode);
  edgeParent.append('br');
  const v = edgeParent.append('span');
  v.classed('diagram-value', true);
  v.html(formattedValueToString(indicator));
  resizeGrouping(edgeParent, nodeSize);
  if (indicator.color) {
    if (useBackground) {
      v.style('background-color', indicator.color);
      const parentShapeElement = fetchParentsUntilShapeElementFound(targetElement.node(), '.node.flowchart-label');
      parentShapeElement?.firstElementChild?.setAttribute('style', `fill: ${indicator.color}`);
    } else {
      v.style('color', indicator.color);
    }
  }
};

const styleTextEdgeLabel = (
  targetElement: D3Selection,
  indicator: MetricIndicator,
  useBackground: boolean
) => {
  targetElement.each((el: SVGGraphicsElement) => {
    // Cache DOM measurement to avoid repeated getBBox() calls
    const bbox = el.getBBox();
    let markerBox = {
      x: bbox.x,
      y: bbox.y + bbox.height + 10,
      width: bbox.width,
      height: bbox.height,
    };
    if (indicator.color) {
      const parentNode = el.parentNode as HTMLElement;
      const rect = select(parentNode)
        .insert('rect')
        .attr('x', markerBox.x)
        .attr('y', markerBox.y)
        .attr('width', markerBox.width)
        .attr('height', markerBox.height);
      const textNode = select(parentNode)
        .insert('text')
        .text(formattedValueToString(indicator))
        .attr('x', markerBox.x + markerBox.width / 2)
        .attr('y', markerBox.y + markerBox.height - 1)
        .attr('width', markerBox.width)
        .attr('height', markerBox.height)
        .style('text-anchor', 'middle');
      if (indicator.color) {
        if (useBackground) {
          rect.style('fill', indicator.color);
        } else {
          textNode.style('color', indicator.color);
        }
      }
    }
  });
};

const styleSequenceDiagramEdgeLabel = (
  targetElement: D3Selection,
  indicator: MetricIndicator,
  useBackground: boolean,
  nodeSize: NodeSizeOptions
) => {
  const spanElement = targetElement.append('tspan');
  spanElement.classed('diagram-value', true);
  spanElement.html(formattedValueToString(indicator));
  if (indicator.color) {
    if (useBackground) {
      spanElement.style('background-color', indicator.color);
    } else {
      spanElement.style('color', indicator.color);
    }
  }
}

const injectCustomStyle = (container: HTMLElement, diagramStyle: string, diagramId: string) => {
  const diagramDiv = select(container);
  const diagramStyleElement = diagramDiv.append('style');
  diagramStyleElement.text(diagramStyleFormatter(diagramStyle, diagramId));
};

const processDiagramSeriesModel = (container: HTMLElement, indicator: MetricIndicator, options: DiagramOptions) => {
  const key = indicator.metricName;

  // Find nodes by ID if we can
  let targetElement = selectElementById(container, key);
  if (!targetElement.empty()) {
    styleD3Shapes(targetElement, indicator, options.useBackground, options.nodeSize);
    return;
  }

  targetElement = selectElementByEdgeLabel(container, key);
  if (!targetElement.empty()) {
    styleFlowChartEdgeLabel(targetElement, indicator, options.useBackground, options.nodeSize);
    return;
  }

  targetElement = selectDivElementByAlias(container, key);
  if (!targetElement.empty()) {
    styleD3Shapes(targetElement, indicator, options.useBackground, options.nodeSize);
    return;
  }

  targetElement = selectTextElementByAlias(container, key);
  if (!targetElement.empty()) {
    styleTextEdgeLabel(targetElement, indicator, options.useBackground);
    return;
  }

  targetElement = selectTextElementContainingAlias(container, key);
  if (!targetElement.empty()) {
    styleSequenceDiagramEdgeLabel(targetElement, indicator, options.useBackground, options.nodeSize);
    return;
  }

  //console.log('could not find a diagram node with id/text: ' + key);
};

const reduceComposites = (indicators: MetricIndicator[], composites: CompositeMetric[]): MetricIndicator[] => {
  return composites
    .map((c) => {
      const candidates = c.members.flatMap((m) => {
        return indicators.filter((i) => i.metricName === m);
      });
      if (candidates.length > 0) {
        const compositeIndicator = candidates.reduce((prev, current) => {
          // Use Number.isNaN instead of isNaN for strict checking
          const previousValue = Number.isNaN(prev.numeric) ? 0 : prev.numeric;
          const currentValue = Number.isNaN(current.numeric) ? 0 : current.numeric;
          const currentIsLower = currentValue < previousValue;
          if (c.showLowestValue) {
            return currentIsLower ? current : prev;
          } else {
            return currentIsLower ? prev : current;
          }
        });
        compositeIndicator.isComposite = true;
        compositeIndicator.originalName = compositeIndicator.metricName;
        compositeIndicator.metricName = c.name;
        return compositeIndicator;
      } else {
        return null;
      }
    })
    .filter((c): c is MetricIndicator => c != null);
};

const reduceModels = (models: DiagramSeriesModel[]): MetricIndicator[] => {
  return models
    .filter((m) => m.valueField.config.custom)
    .flatMap((m) => {
      const dv = m.info?.find((dv) => dv.title === m.valueField.config.custom.valueName);
      if (!dv) {
        return null;
      }
      return {
        ...dv,
        metricName: m.label,
        valueName: dv.title,
      };
    })
    .filter((m): m is MetricIndicator => m != null);
};

export const updateDiagramStyle = (
  el: HTMLElement,
  models: DiagramSeriesModel[],
  options: DiagramOptions,
  diagramId: string
) => {
  const indicators: MetricIndicator[] = reduceModels(models);

  const svgSelection = select(el).select('svg');
  const svgNode = svgSelection.node();
  if (svgNode == null) {
    return;
  }

  const svg = svgNode as HTMLElement;
  if (options.maxWidth) {
    select(svg).style('max-width', '100%').style('max-height', '100%');
  }

  if (svg.parentElement && !options.maxWidth) {
    svg.parentElement.setAttribute('style', 'overflow-y: scroll');
  }

  indicators.forEach((indicator) => {
    processDiagramSeriesModel(svg, indicator, options);
  });
  reduceComposites(indicators, options.composites ?? []).forEach((indicator) => {
    processDiagramSeriesModel(svg, indicator, options);
  });

  injectCustomStyle(el, options.style, diagramId);
};
