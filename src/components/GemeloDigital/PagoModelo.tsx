import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, CreditCard, Loader2, Wallet } from 'lucide-react';
import { Button } from '../ui/Button';

interface Props {
  onPagado: (pagoId: string) => void;
  onCancelar: () => void;
}

type ModoPago = 'demo' | 'mercadopago';

interface MetodosHabilitados {
  mercadopago: boolean;
  paypal: boolean;
  stripe: boolean;
  applepay: boolean;
  googlepay: boolean;
}

interface Orden {
  id: string;
  montoUsd: number;
  moneda: 'USD' | 'ARS';
  montoMoneda: number;
  estado: 'pendiente' | 'pagado';
  modo: ModoPago;
  initPoint?: string;
  metodos?: MetodosHabilitados;
}

export const PagoModelo = ({ onPagado, onCancelar }: Props) => {
  const [orden, setOrden] = useState<Orden | null>(null);
  const [estado, setEstado] = useState<'pendiente' | 'pagado'>('pendiente');
  const [creando, setCreando] = useState(true);
  const [verificando, setVerificando] = useState(false);
  const [abrioPago, setAbrioPago] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const avisado = useRef(false);
  const consultando = useRef(false);
  const onPagadoRef = useRef(onPagado);
  onPagadoRef.current = onPagado;

  const avisar = (pagoId: string) => {
    if (avisado.current) return;
    avisado.current = true;
    setEstado('pagado');
    onPagadoRef.current(pagoId);
  };

  const cargar = async () => {
    setCreando(true);
    setError(null);
    try {
      const existente = await fetch(`/api/visor/pagos`, { cache: 'no-store' });
      const datosExistente = (await existente.json().catch(() => null)) as
        | { id: string; estado: 'pendiente' | 'pagado'; initPoint?: string; moneda?: string; montoMoneda?: number; metodos?: MetodosHabilitados }
        | null;

      if (
        existente.ok &&
        datosExistente?.id &&
        (datosExistente.estado === 'pagado' || datosExistente.initPoint)
      ) {
        const ordenCompleta: Orden = {
          id: datosExistente.id,
          montoUsd: 2,
          moneda: (datosExistente.moneda as any) || 'USD',
          montoMoneda: Number(datosExistente.montoMoneda || 2),
          estado: datosExistente.estado as any,
          modo: 'mercadopago',
          initPoint: datosExistente.initPoint,
          metodos: datosExistente.metodos,
        };
        setOrden(ordenCompleta);
        if (ordenCompleta.estado === 'pagado') avisar(ordenCompleta.id);
        setEstado(ordenCompleta.estado as any);
        return;
      }

      const nueva = await fetch(`/api/visor/pagos`, {
        method: 'POST',
        cache: 'no-store',
      });
      const datosNueva = (await nueva.json().catch(() => null)) as
        | {
            id: string;
            montoUsd: number;
            moneda: string;
            montoMoneda: number;
            estado: 'pendiente' | 'pagado';
            modo: ModoPago;
            initPoint?: string;
            metodos?: MetodosHabilitados;
            error?: string;
          }
        | null;

      if (nueva.ok && datosNueva?.id) {
        setOrden(datosNueva as any);
        if (datosNueva.estado === 'pagado') avisar(datosNueva.id);
        setEstado(datosNueva.estado as any);
      } else {
        const err = datosNueva?.error || 'No se pudo generar la orden de pago.';
        setError(err);
        if (datosExistente?.id) {
          setOrden({
            id: datosExistente.id,
            montoUsd: 2,
            moneda: (datosExistente.moneda as any) || 'USD',
            montoMoneda: Number(datosExistente.montoMoneda || 2),
            estado: datosExistente.estado as any,
            modo: 'mercadopago',
            initPoint: datosExistente.initPoint,
            metodos: datosExistente.metodos,
          });
        }
      }
    } catch (e) {
      setError('Error de conexión al procesar el pago.');
    } finally {
      setCreando(false);
    }
  };

  useEffect(() => {
    cargar();
  }, []);

  const consultar = async () => {
    if (!orden || consultando.current) return;
    consultando.current = true;
    try {
      const respuesta = await fetch(`/api/visor/pagos/${orden.id}`, { cache: 'no-store' });
      const datos = (await respuesta.json().catch(() => null)) as
        | { estado?: 'pendiente' | 'pagado'; error?: string }
        | null;
      if (respuesta.ok && datos?.estado === 'pagado') {
        setEstado('pagado');
        avisar(orden.id);
      }
    } catch {
      void 0;
    } finally {
      consultando.current = false;
    }
  };

  const verificar = async () => {
    if (!orden || consultando.current) return;
    consultando.current = true;
    setVerificando(true);
    setError(null);
    try {
      const respuesta = await fetch(`/api/visor/pagos/${orden.id}`, {
        method: 'POST',
        cache: 'no-store',
      });
      const datos = (await respuesta.json().catch(() => null)) as
        | { estado?: 'pendiente' | 'pagado'; error?: string }
        | null;
      if (respuesta.ok && datos?.estado === 'pagado') {
        setEstado('pagado');
        avisar(orden.id);
      } else if (!respuesta.ok) {
        setError(datos?.error || 'No se pudo verificar el pago.');
      }
    } catch {
      setError('No se pudo verificar el pago. Revisá tu conexión.');
    } finally {
      consultando.current = false;
      setVerificando(false);
    }
  };

  useEffect(() => {
    if (!orden || estado !== 'pendiente' || orden.modo !== 'mercadopago') return;
    const intervalo = window.setInterval(() => {
      void consultar();
    }, 8000);
    return () => window.clearInterval(intervalo);
  }, [orden, estado]);

  if (creando) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 rounded-3xl border border-cyan-100 bg-cyan-50/50 p-10 text-center">
        <Loader2 className="h-10 w-10 animate-spin text-cyan-600" />
        <p className="text-sm font-medium text-slate-600">Preparando pasarela de pagos...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 rounded-3xl border border-red-100 bg-red-50 p-10 text-center">
        <AlertTriangle className="h-10 w-10 text-red-500" />
        <div className="space-y-2">
          <p className="text-sm font-bold text-red-900">Hubo un problema con el pago</p>
          <p className="text-xs text-red-600">{error}</p>
        </div>
        <Button variant="outline" size="sm" onClick={cargar}>Reintentar</Button>
      </div>
    );
  }

  if (estado === 'pagado') {
    return (
      <div className="flex items-center gap-3 rounded-3xl border border-emerald-200 bg-emerald-50 px-5 py-6">
        <Check className="h-5 w-5 text-emerald-600" />
        <p className="text-sm font-medium text-emerald-900">Pago acreditado. Podés subir las fotos.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 rounded-3xl border border-cyan-200 bg-white p-6 shadow-sm">
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-cyan-600 text-white">
          <CreditCard className="h-6 w-6" />
        </div>
        <div>
          <p className="text-base font-bold text-slate-800">Modelo 3D · USD {orden?.montoUsd}</p>
          <p className="mt-1 text-sm text-slate-600">
            Se cobra una sola vez por modelo. Si no completás el pago, no se genera nada.
          </p>
          {orden?.moneda === 'ARS' && (
            <p className="mt-1 text-xs text-slate-500 font-medium">
              Equivalente en pesos: ARS {orden?.montoMoneda?.toLocaleString('es-AR')}
            </p>
          )}
        </div>
      </div>

      <div className="space-y-4">
        <p className="text-sm font-bold text-slate-700">Seleccioná tu método de pago:</p>
        
        <div className="grid grid-cols-2 gap-3">
          <PaymentMethod 
            label="Tarjeta de Crédito/Débito"
            icon="https://upload.wikimedia.org/wikipedia/commons/thumb/5/5e/Visa_Inc._logo.svg/100px- la.svg.png"
            isActive={orden?.metodos?.mercadopago}
            onClick={() => {
              setAbrioPago(true);
              if (orden?.initPoint) window.open(orden.initPoint, '_blank', 'noopener,noreferrer');
            }}
            isLoading={verificando}
            showWarning={abrioPago}
          />
          <PaymentMethod 
            label="PayPal"
            icon="https://upload.wikimedia.org/wikipedia/commons/thumb/b/b5/PayPal.svg/1200px-PayPal.svg.png"
            isActive={orden?.metodos?.paypal}
            onClick={() => {}}
            isDisabled={true}
            message="Próximamente"
          />
          <PaymentMethod 
            label="Apple Pay"
            icon="https://upload.wikimedia.org/wikipedia/commons/thumb/b/b0/Apple_Pay_logo.svg/1200px-Apple_Pay_logo.svg.png"
            isActive={orden?.metodos?.applepay}
            onClick={() => {}}
            isDisabled={true}
            message="Próximamente"
          />
          <PaymentMethod 
            label="Google Pay"
            icon="https://upload.wikimedia.org/wikipedia/commons/thumb/g/g3/Google_Pay_logo.svg/1200px-Google_Pay_logo.svg.png"
            isActive={orden?.metodos?.googlepay}
            onClick={() => {}}
            isDisabled={true}
            message="Próximamente"
          />
          <PaymentMethod 
            label="MercadoPago"
            icon="https://upload.wikimedia.org/wikipedia/commons/thumb/2/2b/Mercado_Pago_logo.svg/1200px-Mercado_Pago_logo.svg.png"
            isActive={orden?.metodos?.mercadopago}
            onClick={() => {
              setAbrioPago(true);
              if (orden?.initPoint) window.open(orden.initPoint, '_blank', 'noopener,noreferrer');
            }}
            isLoading={verificando}
            showWarning={abrioPago}
          />
          <PaymentMethod 
            label="Transferencia"
            icon="https://cdn-icons-png.flaticon.com/512/2489/2489756.png"
            isActive={false}
            onClick={() => {}}
            isDisabled={true}
            message="No disponible"
          />
        </div>
      </div>

      <div className="flex flex-col gap-4 pt-4 border-t border-slate-100">
        <div className="flex gap-2">
          <Button 
            type="button" 
            variant="outline" 
            className="flex-1"
            onClick={() => void verificar()} 
            isLoading={verificando}
          >
            Ya pagué, verificar
          </Button>
          <Button 
            type="button" 
            variant="ghost" 
            className="flex-1"
            onClick={onCancelar}
          >
            Cancelar
          </Button>
        </div>
        {abrioPago && (
          <p className="text-[10px] text-center text-slate-400 leading-tight">
            Si ya completaste el pago en la otra pestaña, no lo hagas de nuevo. <br />
            Esperá unos segundos o tocá "Ya pagué, verificar".
          </p>
        )}
      </div>
    </div>
  );
};

interface PaymentMethodProps {
  label: string;
  icon: string;
  isActive?: boolean;
  onClick?: () => void;
  isLoading?: boolean;
  showWarning?: boolean;
  isDisabled?: boolean;
  message?: string;
}

function PaymentMethod({ label, icon, isActive, onClick, isDisabled, message }: PaymentMethodProps) {
  const [hovered, setHovered] = useState(false);

  return (
    <div 
      className={`relative group cursor-pointer rounded-2xl border-2 p-3 transition-all duration-200 ${
        isDisabled 
          ? 'border-slate-100 bg-slate-50 cursor-not-allowed opacity-60' 
          : isActive 
            ? 'border-cyan-500 bg-white hover:border-cyan-600' 
            : 'border-slate-200 bg-slate-50'
      }`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={!isDisabled ? onClick : undefined}
    >
      <div className="flex flex-col items-center justify-center gap-2 text-center">
        <img src={icon} alt={label} className="h-6 w-auto object-contain grayscale group-hover:grayscale-0 transition-all duration-300" />
        <span className="text-[11px] font-medium text-slate-600">{label}</span>
      </div>

      {isDisabled && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/60 rounded-2xl pointer-events-none">
          <span className="text-[10px] font-bold text-slate-400 uppercase">{message}</span>
        </div>
      )}
      {hovered && isActive && (
        <div className="absolute -top-2 -right-2 bg-cyan-500 text-white rounded-full p-1 shadow-sm">
          <Check className="h-3 w-3" />
        </div>
      )}
    </div>
  );
}
