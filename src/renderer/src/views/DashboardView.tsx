import { useCallback, useEffect, useState, type ReactElement } from 'react';
import type { DashboardData, ExpirationAlert, StockAlert } from '../../../shared/dashboard';
import type { Role } from '../../../shared/navigation';
import { ResumenVentasDashboard } from '../components';

type DashboardViewProps = {
  role: Role;
  onNavigate: (path: string) => void;
};

type DashboardState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: DashboardData };

export function DashboardView({
  role,
  onNavigate,
}: DashboardViewProps): ReactElement {
  const [state, setState] = useState<DashboardState>({ status: 'loading' });

  const loadDashboard = useCallback(async (): Promise<void> => {
    setState({ status: 'loading' });

    try {
      const response = await window.appApi.invoke<DashboardData>(
        'dashboard:cargar',
        { role },
      );

      if (!response.ok) {
        setState({ status: 'error', message: response.error.message });
        return;
      }

      setState({ status: 'ready', data: response.data });
    } catch {
      setState({
        status: 'error',
        message: 'No fue posible comunicarse con el proceso principal.',
      });
    }
  }, [role]);

  useEffect(() => {
    void loadDashboard();
    return window.appApi.onDashboardUpdated(() => {
      void loadDashboard();
    });
  }, [loadDashboard]);

  if (state.status === 'loading') {
    return (
      <section className="px-8 py-8" aria-live="polite">
        <div className="rounded-md border border-[#cbd5df] bg-white p-8 shadow-sm">
          <p className="font-semibold text-[#244d61]">
            Cargando indicadores del dia...
          </p>
        </div>
      </section>
    );
  }

  if (state.status === 'error') {
    return (
      <section className="px-8 py-8" aria-live="assertive">
        <div className="rounded-md border border-[#dba7a7] bg-[#fff7f7] p-6 shadow-sm">
          <h3 className="text-lg font-semibold text-[#8f2727]">
            No se pudo cargar el inicio
          </h3>
          <p className="mt-2 text-sm text-[#6f3333]">{state.message}</p>
          <button
            className="mt-5 rounded-md bg-[#244d61] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#1f4354]"
            type="button"
            onClick={() => void loadDashboard()}
          >
            Reintentar
          </button>
        </div>
      </section>
    );
  }

  const { data } = state;
  const hasStockAlerts = data.stockAlerts.length > 0;
  const hasExpirationAlerts =
    data.expirationAlerts.expired.length > 0 ||
    data.expirationAlerts.expiringSoon.length > 0;
  const hasAttendancePending = data.attendance.workersWithoutAttendance > 0;

  return (
    <section className="space-y-6 px-8 py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-2xl font-semibold text-[#17202a]">
            Resumen operativo
          </h3>
          <p className="mt-1 text-sm text-[#61717f]">
            Indicadores del {formatDate(data.generatedAt)}
          </p>
        </div>
        <p className="text-xs text-[#61717f]" aria-live="polite">
          Actualizado a las {formatTime(data.generatedAt)}
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <ResumenVentasDashboard
          total={data.sales.currentAmount}
          transacciones={data.sales.currentTransactions}
          montoAnulado={data.sales.voidedAmount}
          transaccionesAnuladas={data.sales.voidedTransactions}
        />
        <IndicatorCard
          title="Asistencia de hoy"
          icon="attendance"
          alert={hasAttendancePending}
        >
          <p className="text-2xl font-semibold text-[#17202a]">
            {data.attendance.workersWithAttendance} de{' '}
            {data.attendance.activeWorkers}
          </p>
          <p className="mt-1 text-sm text-[#61717f]">
            trabajadores activos con entrada registrada
          </p>
          {hasAttendancePending ? (
            <p className="mt-3 text-sm font-semibold text-[#9a4f12]">
              {data.attendance.workersWithoutAttendance} sin registro de
              asistencia
            </p>
          ) : (
            <p className="mt-3 text-sm font-semibold text-[#2d6a4f]">
              Todos los trabajadores activos registraron asistencia
            </p>
          )}
          <button
            className="mt-4 text-sm font-semibold text-[#244d61] underline-offset-4 hover:underline"
            type="button"
            onClick={() => onNavigate('/app/personal/asistencia')}
          >
            Ir a asistencia
          </button>
        </IndicatorCard>
      </div>

      <IndicatorSection
        title="Stock critico"
        description="Productos con stock igual o inferior al minimo definido."
        icon="stock"
        alert={hasStockAlerts}
        count={data.stockAlerts.length}
      >
        <StockAlertsTable alerts={data.stockAlerts} />
      </IndicatorSection>

      <IndicatorSection
        title="Vencimientos"
        description="Lotes vencidos y con vencimiento durante los proximos 7 dias."
        icon="expiration"
        alert={hasExpirationAlerts}
        count={
          data.expirationAlerts.expired.length +
          data.expirationAlerts.expiringSoon.length
        }
      >
        <div className="grid gap-5 xl:grid-cols-2">
          <ExpirationAlertsTable
            title="Lotes vencidos"
            alerts={data.expirationAlerts.expired}
            emptyMessage="No hay lotes vencidos con stock disponible."
            expired
          />
          <ExpirationAlertsTable
            title="Proximos a vencer"
            alerts={data.expirationAlerts.expiringSoon}
            emptyMessage="No hay lotes que venzan durante los proximos 7 dias."
          />
        </div>
      </IndicatorSection>
    </section>
  );
}

function IndicatorCard({
  title,
  icon,
  alert,
  children,
}: {
  title: string;
  icon: DashboardIconName;
  alert: boolean;
  children: React.ReactNode;
}): ReactElement {
  return (
    <article
      className={`rounded-md border bg-white p-6 shadow-sm ${
        alert ? 'border-[#e3ad72]' : 'border-[#cbd5df]'
      }`}
    >
      <div className="mb-4 flex items-center gap-3">
        <DashboardIcon name={icon} alert={alert} />
        <h4 className="text-base font-semibold text-[#17202a]">{title}</h4>
      </div>
      {children}
    </article>
  );
}

function IndicatorSection({
  title,
  description,
  icon,
  alert,
  count,
  children,
}: {
  title: string;
  description: string;
  icon: DashboardIconName;
  alert: boolean;
  count: number;
  children: React.ReactNode;
}): ReactElement {
  return (
    <article
      className={`rounded-md border bg-white p-6 shadow-sm ${
        alert ? 'border-[#e3ad72]' : 'border-[#cbd5df]'
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <DashboardIcon name={icon} alert={alert} />
          <div>
            <h4 className="text-lg font-semibold text-[#17202a]">{title}</h4>
            <p className="mt-1 text-sm text-[#61717f]">{description}</p>
          </div>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-sm font-semibold ${
            alert
              ? 'bg-[#fff0dc] text-[#914b0e]'
              : 'bg-[#e8f3ed] text-[#2d6a4f]'
          }`}
        >
          {count}
        </span>
      </div>
      <div className="mt-5">{children}</div>
    </article>
  );
}

function StockAlertsTable({ alerts }: { alerts: StockAlert[] }): ReactElement {
  if (alerts.length === 0) {
    return <EmptyState message="No hay productos con stock critico." />;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-[#d7dee6] text-[#61717f]">
            <th className="px-3 py-3 font-semibold">Producto</th>
            <th className="px-3 py-3 font-semibold">EAN-13</th>
            <th className="px-3 py-3 font-semibold">Categoria</th>
            <th className="px-3 py-3 text-right font-semibold">Stock actual</th>
            <th className="px-3 py-3 text-right font-semibold">Stock minimo</th>
          </tr>
        </thead>
        <tbody>
          {alerts.map((alert) => (
            <tr
              className="border-b border-[#edf0f3] last:border-0"
              key={alert.ean13}
            >
              <td className="px-3 py-3 font-medium text-[#24313d]">
                {alert.productName}
              </td>
              <td className="px-3 py-3 text-[#61717f]">{alert.ean13}</td>
              <td className="px-3 py-3 text-[#61717f]">
                {alert.categoryName}
              </td>
              <td className="px-3 py-3 text-right font-semibold text-[#9a4f12]">
                {alert.currentStock}
              </td>
              <td className="px-3 py-3 text-right text-[#61717f]">
                {alert.minimumStock}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ExpirationAlertsTable({
  title,
  alerts,
  emptyMessage,
  expired = false,
}: {
  title: string;
  alerts: ExpirationAlert[];
  emptyMessage: string;
  expired?: boolean;
}): ReactElement {
  return (
    <section>
      <h5 className="font-semibold text-[#24313d]">{title}</h5>
      {alerts.length === 0 ? (
        <div className="mt-3">
          <EmptyState message={emptyMessage} />
        </div>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-[#d7dee6] text-[#61717f]">
                <th className="px-3 py-3 font-semibold">Producto</th>
                <th className="px-3 py-3 text-right font-semibold">Cantidad</th>
                <th className="px-3 py-3 font-semibold">Vencimiento</th>
                <th className="px-3 py-3 font-semibold">Estado</th>
              </tr>
            </thead>
            <tbody>
              {alerts.map((alert) => (
                <tr
                  className="border-b border-[#edf0f3] last:border-0"
                  key={alert.lotId}
                >
                  <td className="px-3 py-3">
                    <p className="font-medium text-[#24313d]">
                      {alert.productName}
                    </p>
                    <p className="mt-1 text-xs text-[#61717f]">{alert.ean13}</p>
                  </td>
                  <td className="px-3 py-3 text-right">
                    {alert.availableQuantity}
                  </td>
                  <td className="px-3 py-3">
                    {formatShortDate(alert.expirationDate)}
                  </td>
                  <td className="px-3 py-3">
                    <span
                      className={`font-semibold ${
                        expired ? 'text-[#a02f2f]' : 'text-[#9a4f12]'
                      }`}
                    >
                      {expired
                        ? 'Vencido'
                        : alert.daysRemaining === 0
                          ? 'Vence hoy'
                          : `${alert.daysRemaining} dias`}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function EmptyState({ message }: { message: string }): ReactElement {
  return (
    <p className="rounded-md bg-[#f5f8f6] px-4 py-4 text-sm font-medium text-[#466456]">
      {message}
    </p>
  );
}

type DashboardIconName = 'attendance' | 'stock' | 'expiration';

function DashboardIcon({
  name,
  alert,
}: {
  name: DashboardIconName;
  alert: boolean;
}): ReactElement {
  const path =
    name === 'attendance'
      ? 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M19 8v6 M22 11h-6'
      : name === 'stock'
        ? 'M3 7h18 M5 7l1 14h12l1-14 M9 11v6 M15 11v6 M8 3h8l1 4H7l1-4'
        : 'M12 8v5l3 2 M21 12a9 9 0 1 1-9-9 9 9 0 0 1 9 9';

  return (
    <span
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md ${
        alert
          ? 'bg-[#fff0dc] text-[#9a4f12]'
          : 'bg-[#e8f3ed] text-[#2d6a4f]'
      }`}
      aria-hidden="true"
    >
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={path} />
      </svg>
    </span>
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('es-CL', {
    timeZone: 'America/Santiago',
    dateStyle: 'long',
  }).format(new Date(value));
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat('es-CL', {
    timeZone: 'America/Santiago',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatShortDate(value: string): string {
  return new Intl.DateTimeFormat('es-CL', {
    timeZone: 'UTC',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(`${value}T00:00:00Z`));
}
