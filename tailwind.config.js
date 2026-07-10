/** @type {import('tailwindcss').Config} */
export default {
    darkMode: ['class'],
    content: [
        './index.html',
        './src/**/*.{js,ts,jsx,tsx}',
    ],
	theme: {
		extend: {
    		colors: {
				border: 'oklch(var(--border) / <alpha-value>)',
				input: 'oklch(var(--input) / <alpha-value>)',
				ring: 'oklch(var(--ring) / <alpha-value>)',
				background: 'oklch(var(--background) / <alpha-value>)',
				foreground: 'oklch(var(--foreground) / <alpha-value>)',
				canvas: 'oklch(var(--canvas) / <alpha-value>)',
				success: 'oklch(var(--success) / <alpha-value>)',
				warning: 'oklch(var(--warning) / <alpha-value>)',
				info: 'oklch(var(--info) / <alpha-value>)',
				scrim: 'oklch(var(--scrim) / <alpha-value>)',
    			primary: {
					DEFAULT: 'oklch(var(--primary) / <alpha-value>)',
					foreground: 'oklch(var(--primary-foreground) / <alpha-value>)'
    			},
    			secondary: {
					DEFAULT: 'oklch(var(--secondary) / <alpha-value>)',
					foreground: 'oklch(var(--secondary-foreground) / <alpha-value>)'
    			},
    			destructive: {
					DEFAULT: 'oklch(var(--destructive) / <alpha-value>)',
					foreground: 'oklch(var(--destructive-foreground) / <alpha-value>)'
    			},
    			muted: {
					DEFAULT: 'oklch(var(--muted) / <alpha-value>)',
					foreground: 'oklch(var(--muted-foreground) / <alpha-value>)'
    			},
    			accent: {
					DEFAULT: 'oklch(var(--accent) / <alpha-value>)',
					foreground: 'oklch(var(--accent-foreground) / <alpha-value>)'
    			},
    			popover: {
					DEFAULT: 'oklch(var(--popover) / <alpha-value>)',
					foreground: 'oklch(var(--popover-foreground) / <alpha-value>)'
    			},
    			card: {
					DEFAULT: 'oklch(var(--card) / <alpha-value>)',
					foreground: 'oklch(var(--card-foreground) / <alpha-value>)'
    			},
    			glass: {
					DEFAULT: 'oklch(var(--card) / 0.72)',
					border: 'oklch(var(--border) / 0.72)',
					hover: 'oklch(var(--accent) / 0.72)'
    			},
    			chart: {
					'1': 'oklch(var(--chart-1) / <alpha-value>)',
					'2': 'oklch(var(--chart-2) / <alpha-value>)',
					'3': 'oklch(var(--chart-3) / <alpha-value>)',
					'4': 'oklch(var(--chart-4) / <alpha-value>)',
					'5': 'oklch(var(--chart-5) / <alpha-value>)'
    			}
    		},
    		borderRadius: {
    			lg: 'var(--radius)',
    			md: 'calc(var(--radius) - 2px)',
				sm: 'calc(var(--radius) - 4px)',
				panel: 'var(--radius-panel)',
				control: 'var(--radius-control)'
    		},
    		fontFamily: {
    			sans: [
    				'Pretendard Variable',
    				'Pretendard',
					'Noto Sans KR',
					'Apple SD Gothic Neo',
					'Malgun Gothic',
    				'-apple-system',
    				'BlinkMacSystemFont',
    				'system-ui',
    				'sans-serif'
    			],
    			mono: [
    				'JetBrains Mono',
					'D2Coding',
					'Consolas',
					'monospace'
				]
    		},
		boxShadow: {
			panel: '0 8px 24px oklch(var(--scrim) / 0.16)',
			overlay: '0 16px 48px oklch(var(--scrim) / 0.28)',
		},
		transitionDuration: {
			fast: '120ms',
			standard: '180ms',
			overlay: '240ms',
		},
		transitionTimingFunction: {
			standard: 'cubic-bezier(0.2, 0, 0, 1)',
		},
    		keyframes: {
    			'accordion-down': {
    				from: {
    					height: '0'
    				},
    				to: {
    					height: 'var(--radix-accordion-content-height)'
    				}
    			},
    			'accordion-up': {
    				from: {
    					height: 'var(--radix-accordion-content-height)'
    				},
    				to: {
    					height: '0'
    				}
    			},
    			'fade-in': {
    				from: {
    					opacity: '0'
    				},
    				to: {
    					opacity: '1'
    				}
    			},
    			'slide-in-from-top': {
    				from: {
    					transform: 'translateY(-10px)',
    					opacity: '0'
    				},
    				to: {
    					transform: 'translateY(0)',
    					opacity: '1'
    				}
    			},
    			'slide-in-from-bottom': {
    				from: {
    					transform: 'translateY(10px)',
    					opacity: '0'
    				},
    				to: {
    					transform: 'translateY(0)',
    					opacity: '1'
    				}
    			},
    			shimmer: {
    				'0%': {
    					backgroundPosition: '-200% 0'
    				},
    				'100%': {
    					backgroundPosition: '200% 0'
    				}
    			}
    		},
    		animation: {
    			'accordion-down': 'accordion-down 0.2s ease-out',
    			'accordion-up': 'accordion-up 0.2s ease-out',
    			'fade-in': 'fade-in 0.2s ease-out',
    			'slide-in-from-top': 'slide-in-from-top 0.2s ease-out',
    			'slide-in-from-bottom': 'slide-in-from-bottom 0.2s ease-out',
    			shimmer: 'shimmer 2s linear infinite'
    		},
    		backdropBlur: {
    			xs: '2px'
    		}
    	}
    },
    plugins: [require("tailwindcss-animate")],
}
