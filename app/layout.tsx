import type {Metadata} from 'next';
import './globals.css';
const siteUrl = 'https://asca.au.dk/annotation-lab';
const assetUrl = 'https://text-annotation-lab.jenskc1987.chatgpt.site';
const description = 'A teaching resource for AI-assisted text annotation and content analysis, developed for students in the Department of English at Aarhus University and open to others who find it useful.';
const sharingImage = {url: assetUrl + '/branding/social-card.png', width: 1200, height: 630, alt: 'Text Annotation Lab — AI-assisted text annotation and content analysis. Department of English, Aarhus University.'};
export const metadata:Metadata={metadataBase: new URL(assetUrl), alternates:{canonical:siteUrl}, openGraph: {type: 'website', locale: 'en_US', url: siteUrl, siteName: 'Text Annotation Lab', title: 'Text Annotation Lab | Aarhus University', description, images: [sharingImage]}, twitter: {card: 'summary_large_image', title: 'Text Annotation Lab | Aarhus University', description, images: [sharingImage.url]},icons:{icon:[{url:'/favicon.svg?v=58',type:'image/svg+xml'},{url:'/favicon.ico?v=58',sizes:'16x16 32x32 48x48 64x64'}],apple:'/apple-touch-icon.png?v=58'},title:'Text Annotation Lab | Aarhus University',description:'A teaching resource for AI-assisted text annotation and content analysis, developed for students in the Department of English at Aarhus University and open to others who find it useful.'};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>}
