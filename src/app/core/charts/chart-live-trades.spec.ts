import {
  buildChartLiveTrades,
  extractKiteOrders,
  extractKitePositions,
  isChartOrderTag,
  localChartTrade,
  mergeChartLiveTrades,
  restingSellOrderIds,
} from './chart-live-trades';

describe('chart live trades', () => {
  it('recognises Charts tags and ignores desk tags', () => {
    expect(isChartOrderTag('PALAGAI_CHART')).toBe(true);
    expect(isChartOrderTag('PALAGAI_CHART_SL')).toBe(true);
    expect(isChartOrderTag('PALAGAI_CHART_TP')).toBe(true);
    expect(isChartOrderTag('PALAGAI_CHART_EXIT')).toBe(true);
    expect(isChartOrderTag('PALAGAI')).toBe(false);
  });

  it('lists the instrument, stop and target for an open Auto fill', () => {
    const trades = buildChartLiveTrades(
      [
        {
          order_id: '1',
          tradingsymbol: 'NIFTY25OCT24500CE',
          exchange: 'NFO',
          transaction_type: 'BUY',
          status: 'COMPLETE',
          filled_quantity: 65,
          average_price: 200,
          tag: 'PALAGAI_CHART',
        },
        {
          order_id: '2',
          tradingsymbol: 'NIFTY25OCT24500CE',
          exchange: 'NFO',
          transaction_type: 'SELL',
          status: 'TRIGGER PENDING',
          trigger_price: 150,
          tag: 'PALAGAI_CHART_SL',
        },
        {
          order_id: '3',
          tradingsymbol: 'NIFTY25OCT24500CE',
          exchange: 'NFO',
          transaction_type: 'SELL',
          status: 'OPEN',
          price: 225,
          tag: 'PALAGAI_CHART_TP',
        },
      ],
      [
        {
          tradingsymbol: 'NIFTY25OCT24500CE',
          product: 'MIS',
          quantity: 65,
          average_price: 200,
          last_price: 212,
          pnl: 780,
        },
      ],
    );

    expect(trades).toHaveLength(1);
    expect(trades[0]).toMatchObject({
      book: 'nifty',
      bookLabel: 'Nifty 50',
      instrument: 'NIFTY25OCT24500CE',
      side: 'CE',
      qty: 65,
      entry: 200,
      last: 212,
      sl: 150,
      tp: 225,
      slState: 'RESTING',
      tpState: 'RESTING',
      slOrderId: '2',
      tpOrderId: '3',
      protectiveOrderIds: ['2', '3'],
      status: 'OPEN',
      pnl: 780,
    });
  });

  it('marks a filled target as TP_HIT', () => {
    const trades = buildChartLiveTrades([
      {
        order_id: '1',
        tradingsymbol: 'BANKNIFTY25OCT52000PE',
        transaction_type: 'BUY',
        status: 'COMPLETE',
        filled_quantity: 30,
        average_price: 180,
        tag: 'PALAGAI_CHART',
      },
      {
        order_id: '3',
        tradingsymbol: 'BANKNIFTY25OCT52000PE',
        transaction_type: 'SELL',
        status: 'COMPLETE',
        price: 202.5,
        average_price: 202.5,
        filled_quantity: 30,
        tag: 'PALAGAI_CHART_TP',
      },
    ]);
    expect(trades[0]?.book).toBe('bank');
    expect(trades[0]?.status).toBe('TP_HIT');
    expect(trades[0]?.tp).toBe(202.5);
  });

  it('marks a filled stop as SL_HIT', () => {
    const trades = buildChartLiveTrades([
      {
        order_id: '1',
        tradingsymbol: 'CRUDEOILM26OCT5400CE',
        transaction_type: 'BUY',
        status: 'COMPLETE',
        filled_quantity: 1,
        average_price: 40,
        tag: 'PALAGAI_CHART',
      },
      {
        order_id: '2',
        tradingsymbol: 'CRUDEOILM26OCT5400CE',
        transaction_type: 'SELL',
        status: 'COMPLETE',
        trigger_price: 30,
        average_price: 30,
        filled_quantity: 1,
        tag: 'PALAGAI_CHART_SL',
      },
    ]);
    expect(trades[0]?.book).toBe('crude');
    expect(trades[0]?.status).toBe('SL_HIT');
    expect(trades[0]?.sl).toBe(30);
  });

  it('marks a cap flatten as EXITED once the tagged sell completes', () => {
    const trades = buildChartLiveTrades(
      [
        {
          order_id: '1',
          tradingsymbol: 'NIFTY25OCT24500CE',
          transaction_type: 'BUY',
          status: 'COMPLETE',
          filled_quantity: 65,
          average_price: 200,
          tag: 'PALAGAI_CHART',
        },
        {
          order_id: '4',
          tradingsymbol: 'NIFTY25OCT24500CE',
          transaction_type: 'SELL',
          status: 'COMPLETE',
          filled_quantity: 65,
          average_price: 210,
          tag: 'PALAGAI_CHART_EXIT',
        },
      ],
      [{ tradingsymbol: 'NIFTY25OCT24500CE', product: 'MIS', quantity: 0 }],
    );
    expect(trades[0]?.status).toBe('EXITED');
  });

  it('keeps a just-sent local row until Kite lists that instrument', () => {
    const pending = localChartTrade({
      book: 'nifty',
      instrument: 'NIFTY25OCT24500CE',
      exchange: 'NFO',
      side: 'CE',
      qty: 65,
      entry: 200,
      sl: 150,
      tp: 225,
    });
    expect(pending).toMatchObject({
      bookLabel: 'Nifty 50',
      slState: 'RESTING',
      tpState: 'RESTING',
      status: 'OPEN',
    });
    const merged = mergeChartLiveTrades([], [pending]);
    expect(merged).toHaveLength(1);
    const fromKite = buildChartLiveTrades([
      {
        order_id: '1',
        tradingsymbol: 'NIFTY25OCT24500CE',
        transaction_type: 'BUY',
        status: 'COMPLETE',
        filled_quantity: 65,
        average_price: 201,
        tag: 'PALAGAI_CHART',
      },
    ]);
    expect(mergeChartLiveTrades(fromKite, [pending])[0]?.entry).toBe(201);
  });

  it('reports this fill\'s unrealized P&L, not the day\'s realised total', () => {
    const trades = buildChartLiveTrades(
      [
        {
          order_id: '1',
          tradingsymbol: 'NIFTY25OCT24500CE',
          transaction_type: 'BUY',
          status: 'COMPLETE',
          filled_quantity: 65,
          average_price: 200,
          tag: 'PALAGAI_CHART',
        },
      ],
      [
        {
          tradingsymbol: 'NIFTY25OCT24500CE',
          product: 'MIS',
          quantity: 65,
          average_price: 200,
          last_price: 201.5,
          pnl: 997.5,
          realised: 900,
          unrealised: 97.5,
        },
      ],
    );
    expect(trades[0]?.status).toBe('OPEN');
    expect(trades[0]?.pnl).toBe(97.5);
  });

  it('falls back to (last − entry) × qty when Kite omits unrealised, still ignoring the day pnl', () => {
    const trades = buildChartLiveTrades(
      [
        {
          order_id: '1',
          tradingsymbol: 'NIFTY25OCT24500CE',
          transaction_type: 'BUY',
          status: 'COMPLETE',
          filled_quantity: 65,
          average_price: 200,
          tag: 'PALAGAI_CHART',
        },
      ],
      [
        {
          tradingsymbol: 'NIFTY25OCT24500CE',
          product: 'MIS',
          quantity: 65,
          average_price: 200,
          last_price: 201.5,
          pnl: 997.5,
          realised: 900,
        },
      ],
    );
    expect(trades[0]?.status).toBe('OPEN');
    expect(trades[0]?.pnl).toBe(97.5);
  });

  it('does not treat a missing open-fill P&L as the day total', () => {
    const trades = buildChartLiveTrades(
      [
        {
          order_id: '1',
          tradingsymbol: 'NIFTY25OCT24500CE',
          transaction_type: 'BUY',
          status: 'COMPLETE',
          filled_quantity: 65,
          average_price: 200,
          tag: 'PALAGAI_CHART',
        },
      ],
      [
        {
          tradingsymbol: 'NIFTY25OCT24500CE',
          product: 'MIS',
          quantity: 65,
          pnl: 997.5,
          realised: 900,
        },
      ],
    );
    expect(trades[0]?.status).toBe('OPEN');
    expect(trades[0]?.pnl).toBeNull();
  });

  it('watches a second Crude fill on the same contract after the first was flattened', () => {
    const trades = buildChartLiveTrades(
      [
        {
          order_id: '10',
          tradingsymbol: 'CRUDEOILM26OCT5400CE',
          transaction_type: 'BUY',
          status: 'COMPLETE',
          filled_quantity: 100,
          average_price: 40,
          tag: 'PALAGAI_CHART',
        },
        {
          order_id: '11',
          tradingsymbol: 'CRUDEOILM26OCT5400CE',
          transaction_type: 'SELL',
          status: 'CANCELLED',
          trigger_price: 37,
          tag: 'PALAGAI_CHART_SL',
        },
        {
          order_id: '12',
          tradingsymbol: 'CRUDEOILM26OCT5400CE',
          transaction_type: 'SELL',
          status: 'COMPLETE',
          filled_quantity: 100,
          average_price: 37,
          tag: 'PALAGAI_CHART_EXIT',
        },
        {
          order_id: '20',
          tradingsymbol: 'CRUDEOILM26OCT5400CE',
          transaction_type: 'BUY',
          status: 'COMPLETE',
          filled_quantity: 100,
          average_price: 42,
          tag: 'PALAGAI_CHART',
        },
        {
          order_id: '21',
          tradingsymbol: 'CRUDEOILM26OCT5400CE',
          transaction_type: 'SELL',
          status: 'TRIGGER PENDING',
          trigger_price: 39,
          tag: 'PALAGAI_CHART_SL',
        },
        {
          order_id: '22',
          tradingsymbol: 'CRUDEOILM26OCT5400CE',
          transaction_type: 'SELL',
          status: 'OPEN',
          price: 45,
          tag: 'PALAGAI_CHART_TP',
        },
      ],
      [
        {
          tradingsymbol: 'CRUDEOILM26OCT5400CE',
          product: 'MIS',
          quantity: 100,
          average_price: 42,
          last_price: 45,
          pnl: 600,
          realised: 300,
          unrealised: 300,
        },
      ],
    );
    expect(trades).toHaveLength(1);
    expect(trades[0]).toMatchObject({
      book: 'crude',
      status: 'OPEN',
      entry: 42,
      sl: 39,
      tp: 45,
      slOrderId: '21',
      tpOrderId: '22',
      protectiveOrderIds: ['21', '22'],
      pnl: 300,
    });
  });

  it('does not treat a previous fill\'s completed target as this fill', () => {
    const trades = buildChartLiveTrades(
      [
        {
          order_id: '1',
          tradingsymbol: 'CRUDEOILM26OCT5400CE',
          transaction_type: 'BUY',
          status: 'COMPLETE',
          filled_quantity: 100,
          average_price: 40,
          tag: 'PALAGAI_CHART',
        },
        {
          order_id: '2',
          tradingsymbol: 'CRUDEOILM26OCT5400CE',
          transaction_type: 'SELL',
          status: 'COMPLETE',
          filled_quantity: 100,
          average_price: 43,
          tag: 'PALAGAI_CHART_TP',
        },
        {
          order_id: '3',
          tradingsymbol: 'CRUDEOILM26OCT5400CE',
          transaction_type: 'BUY',
          status: 'COMPLETE',
          filled_quantity: 100,
          average_price: 41,
          tag: 'PALAGAI_CHART',
        },
        {
          order_id: '4',
          tradingsymbol: 'CRUDEOILM26OCT5400CE',
          transaction_type: 'SELL',
          status: 'TRIGGER PENDING',
          trigger_price: 38,
          tag: 'PALAGAI_CHART_SL',
        },
      ],
      [
        {
          tradingsymbol: 'CRUDEOILM26OCT5400CE',
          product: 'MIS',
          quantity: 100,
          average_price: 41,
          last_price: 41,
          unrealised: 0,
        },
      ],
    );
    expect(trades[0]?.status).toBe('OPEN');
    expect(trades[0]?.slOrderId).toBe('4');
    expect(trades[0]?.tpOrderId).toBeNull();
  });

  it('unwraps Kite order and position payloads', () => {
    expect(extractKiteOrders({ data: [{ order_id: '9' }] })).toHaveLength(1);
    expect(
      extractKitePositions({
        data: { day: [{ tradingsymbol: 'X', quantity: 1 }], net: [] },
      }),
    ).toHaveLength(1);
  });

  it('lists every resting SELL that must be cancelled before a flatten', () => {
    const orders = [
      {
        order_id: 'sl',
        tradingsymbol: 'CRUDEOILM26OCT8850CE',
        transaction_type: 'SELL',
        status: 'TRIGGER PENDING',
        product: 'MIS',
        tag: 'PALAGAI_CHART_SL',
      },
      {
        order_id: 'tp',
        tradingsymbol: 'CRUDEOILM26OCT8850CE',
        transaction_type: 'SELL',
        status: 'OPEN',
        product: 'MIS',
        tag: 'PALAGAI_CHART_TP',
      },
      {
        order_id: 'done',
        tradingsymbol: 'CRUDEOILM26OCT8850CE',
        transaction_type: 'SELL',
        status: 'COMPLETE',
        product: 'MIS',
        tag: 'PALAGAI_CHART_EXIT',
      },
      {
        order_id: 'other',
        tradingsymbol: 'NIFTY25OCT24500CE',
        transaction_type: 'SELL',
        status: 'OPEN',
        product: 'MIS',
        tag: 'PALAGAI_CHART_SL',
      },
    ];
    expect(restingSellOrderIds(orders, 'CRUDEOILM26OCT8850CE')).toEqual(['sl', 'tp']);
    expect(restingSellOrderIds(orders, 'CRUDEOILM26OCT8850CE', { chartTaggedOnly: true })).toEqual([
      'sl',
      'tp',
    ]);
  });
});
