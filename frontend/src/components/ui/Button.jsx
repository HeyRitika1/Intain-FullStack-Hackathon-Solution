const variants = {
  primary: "bg-slate-900 text-white hover:bg-slate-800 disabled:bg-slate-400",
  secondary: "bg-white text-slate-800 border border-slate-300 hover:bg-slate-50 disabled:text-slate-400",
  danger: "bg-red-600 text-white hover:bg-red-500 disabled:bg-red-300",
  ghost: "bg-transparent text-slate-700 hover:bg-slate-100",
};

const sizes = {
  sm: "px-2.5 py-1 text-xs",
  md: "px-3.5 py-2 text-sm",
  lg: "px-4 py-2.5 text-base",
};

export default function Button({
  variant = "primary",
  size = "md",
  type = "button",
  className = "",
  children,
  ...rest
}) {
  const cls = `inline-flex items-center justify-center rounded-md font-medium transition disabled:cursor-not-allowed ${variants[variant] || variants.primary} ${sizes[size] || sizes.md} ${className}`;
  return (
    <button type={type} className={cls} {...rest}>
      {children}
    </button>
  );
}
